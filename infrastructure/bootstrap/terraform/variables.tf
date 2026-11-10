variable "github_repository" {
  description = "GitHub repository in 'owner/repo' form. Workflows from any other repo are rejected."
  type        = string
  default     = "TakuoIshida/ai-hackathon"
}

variable "envs" {
  description = "Per-env config. Same spec across dev/stg/prod by policy — only identifiers differ."
  type = map(object({
    project_id = string
    region     = string
  }))
}

variable "wif_pool_id" {
  description = "Workload Identity Pool ID. One pool per env (lives inside that env's project)."
  type        = string
  default     = "github-actions"
}

variable "wif_provider_id" {
  description = "Workload Identity Provider ID under the pool above."
  type        = string
  default     = "github"
}
