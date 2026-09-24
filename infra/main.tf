provider "aws" {
  region = var.aws_region
}

# Generar un sufijo aleatorio para que el nombre del bucket sea único
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# Bucket de S3
resource "aws_s3_bucket" "ml_models" {
  bucket        = "${var.bucket_prefix}-${random_id.bucket_suffix.hex}"
  force_destroy = var.force_destroy
}

# Habilitar versionado
resource "aws_s3_bucket_versioning" "ml_models_versioning" {
  bucket = aws_s3_bucket.ml_models.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Habilitar cifrado SSE-S3
resource "aws_s3_bucket_server_side_encryption_configuration" "ml_models_encryption" {
  bucket = aws_s3_bucket.ml_models.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Bloqueo total de acceso público
resource "aws_s3_bucket_public_access_block" "ml_models_pab" {
  bucket                  = aws_s3_bucket.ml_models.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Usuario IAM
resource "aws_iam_user" "ml_models_user" {
  name = "proyecto3-models"
}

# Generación de Access Keys
resource "aws_iam_access_key" "ml_models_user_key" {
  user = aws_iam_user.ml_models_user.name
}

# Política de mínimo privilegio
data "aws_iam_policy_document" "ml_models_policy_doc" {
  statement {
    sid       = "AllowListBucketModels"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.ml_models.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["models/*"]
    }
  }

  statement {
    sid       = "AllowPutGetModels"
    effect    = "Allow"
    actions   = [
      "s3:PutObject",
      "s3:GetObject"
    ]
    resources = ["${aws_s3_bucket.ml_models.arn}/models/*"]
  }
}

# Adjuntar política al usuario
resource "aws_iam_user_policy" "ml_models_user_policy" {
  name   = "MLModelsS3Access"
  user   = aws_iam_user.ml_models_user.name
  policy = data.aws_iam_policy_document.ml_models_policy_doc.json
}