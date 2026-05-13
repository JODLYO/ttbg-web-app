terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.53.0"
    }
  }
  backend "remote" {
    organization = "board_game_site"
    workspaces {
      name = "ttbg-web-app"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_droplet" "web" {
  name       = "ttbg-web-app"
  image      = var.image
  region     = var.region
  size       = var.droplet_size
  vpc_uuid   = var.vpc_uuid
  monitoring = true
  ssh_keys   = var.ssh_keys_ttbg
}