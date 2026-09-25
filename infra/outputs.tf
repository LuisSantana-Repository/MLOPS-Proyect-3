output "bucket_name" {
  value       = aws_s3_bucket.ml_models.bucket
  description = "El nombre exacto del bucket generado"
}

output "aws_access_key_id" {
  value       = aws_iam_access_key.ml_models_user_key.id
  description = "Access Key ID del usuario de servicio"
  sensitive   = true
}

output "aws_secret_access_key" {
  value       = aws_iam_access_key.ml_models_user_key.secret
  description = "Secret Access Key del usuario de servicio"
  sensitive   = true
}