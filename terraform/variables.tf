variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "region" {
  description = "Region to deploy the Droplet"
  type        = string
  default     = "lon1"
}

variable "droplet_size" {
  description = "Size of the Droplet"
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "image" {
  description = "Droplet image"
  type        = string
  default     = "ubuntu-24-04-x64"
}

variable "ssh_keys_ttbg" {
  description = "SSH key fingerprints or IDs to enable access"
  type        = list(string)
  sensitive   = true
}

variable "vpc_uuid" {
  description = "DigitalOcean VPC UUID for the Droplet"
  type        = string
  sensitive   = false
}