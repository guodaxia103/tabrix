param(
  [string]$ImageName = "tabrix-ubuntu-self-check"
)

$ErrorActionPreference = "Stop"

Write-Host "[ubuntu-self-check] building Docker image: $ImageName" -ForegroundColor Cyan
docker build -f docker/ubuntu-self-check/Dockerfile -t $ImageName .

Write-Host "[ubuntu-self-check] running Docker self-check" -ForegroundColor Cyan
docker run --rm $ImageName

