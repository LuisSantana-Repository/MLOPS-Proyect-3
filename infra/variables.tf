variable "aws_region" {
  type        = string
  description = "Región de AWS para desplegar la infraestructura"
  default     = "us-east-1"
}

variable "bucket_prefix" {
  type        = string
  description = "Prefijo para el nombre único del bucket S3"
  default     = "ml-models-proyecto3"
}

variable "force_destroy" {
  type        = bool
  description = "Permite destruir el bucket aunque contenga objetos (útil para entornos escolares)"
  default     = true
}