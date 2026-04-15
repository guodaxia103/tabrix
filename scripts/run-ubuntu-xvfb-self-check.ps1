param(
  [string]$ImageName = "tabrix-ubuntu-xvfb-self-check"
)

$ErrorActionPreference = "Stop"

Write-Host "[ubuntu-xvfb-self-check] building Docker image: $ImageName" -ForegroundColor Cyan
docker build -f docker/ubuntu-xvfb-self-check/Dockerfile -t $ImageName .

Write-Host "[ubuntu-xvfb-self-check] running Docker self-check" -ForegroundColor Cyan
docker run --rm $ImageName
