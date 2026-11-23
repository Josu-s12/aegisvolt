# =============================================================================
# Red privada por ambiente: VPC + subredes públicas/privadas + VPC Endpoints
# =============================================================================
# Recorrido de un paquete (ver docs/GUIA):
#   Cliente -> API Gateway (endpoint PRIVATE) --(Interface VPCE execute-api, ENIs
#   en subredes privadas, SG vpce 443)--> VPC Link -> NLB interno (subred privada)
#   -> NodePort/Pod del gateway GraphQL en EKS -> microservicios (ClusterIP)
#   -> DynamoDB por el GATEWAY VPCE (ruta con prefix-list en la tabla de rutas
#   privada). Nada sale a internet: las subredes privadas NO tienen ruta 0.0.0.0/0.
# =============================================================================


locals {
  svc = "com.amazonaws.${var.region}"
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true # requerido para private_dns de los Interface VPCE
  tags                 = merge(var.tags, { Name = "${var.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name_prefix}-igw" })
}

# Subredes públicas: solo para balanceadores públicos / NAT si se necesitaran
resource "aws_subnet" "public" {
  count                   = length(var.availability_zones)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true
  tags = merge(var.tags, {
    Name                     = "${var.name_prefix}-public-${var.availability_zones[count.index]}"
    Tier                     = "public"
    "kubernetes.io/role/elb" = "1"
  })
}

# Subredes privadas: nodos EKS, NLB interno y ENIs de los VPC Endpoints
resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]
  tags = merge(var.tags, {
    Name                              = "${var.name_prefix}-private-${var.availability_zones[count.index]}"
    Tier                              = "private"
    "kubernetes.io/role/internal-elb" = "1"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(var.tags, { Name = "${var.name_prefix}-rt-public" })
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Tabla de rutas PRIVADA: solo la ruta local de la VPC + rutas de los Gateway
# Endpoints (S3/DynamoDB) que Terraform agrega abajo. SIN salida a internet.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "${var.name_prefix}-rt-private" })
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ---------------- Security Groups ----------------
resource "aws_security_group" "vpce" {
  name        = "${var.name_prefix}-vpce-sg"
  description = "Interface VPC Endpoints: HTTPS solo desde dentro de la VPC"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTPS desde la VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }
  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-sg" })
}

resource "aws_security_group" "eks_cluster" {
  name        = "${var.name_prefix}-eks-sg"
  description = "Nodos/pods EKS: trafico solo desde la VPC (NLB interno y VPCE)"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "Trafico interno de la VPC: NLB a NodePort y pod a pod"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(var.tags, { Name = "${var.name_prefix}-eks-sg" })
}

# ---------------- VPC Endpoints ----------------
# GATEWAY endpoints (gratis): agregan una ruta con el prefix-list del servicio
# a la tabla de rutas privada.
resource "aws_vpc_endpoint" "s3" {
  count             = var.enable_vpc_endpoints ? 1 : 0
  vpc_id            = aws_vpc.this.id
  service_name      = "${local.svc}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = merge(var.tags, { Name = "${var.name_prefix}-vpce-s3" })
}

resource "aws_vpc_endpoint" "dynamodb" {
  count             = var.enable_vpc_endpoints ? 1 : 0
  vpc_id            = aws_vpc.this.id
  service_name      = "${local.svc}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = merge(var.tags, { Name = "${var.name_prefix}-vpce-dynamodb" })
}

# INTERFACE endpoints (PrivateLink): crean ENIs con IP privada en las subredes
# privadas; private_dns hace que el DNS público del servicio resuelva a esas IPs.
locals {
  interface_services = {
    "execute-api" = "API Gateway privado (APIGW)"
    "logs"        = "CloudWatch Logs"
    "monitoring"  = "CloudWatch Metrics"
    "eks"         = "API del cluster Kubernetes (EKS)"
    "sts"         = "IRSA / credenciales de pods"
    "ecr.api"     = "ECR API (imagenes)"
    "ecr.dkr"     = "ECR Docker registry"
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = var.enable_vpc_endpoints ? local.interface_services : {}
  vpc_id              = aws_vpc.this.id
  service_name        = "${local.svc}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true
  tags                = merge(var.tags, { Name = "${var.name_prefix}-vpce-${replace(each.key, ".", "-")}", Purpose = each.value })
}
