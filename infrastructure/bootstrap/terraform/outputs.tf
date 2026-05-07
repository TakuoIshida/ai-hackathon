output "workload_identity_providers" {
  description = "Full resource name of each env's WIF provider — paste into GitHub workflows as workload_identity_provider."
  value = {
    for k, _ in var.envs :
    k => google_iam_workload_identity_pool_provider.github[k].name
  }
}

output "terraform_ci_service_accounts" {
  description = "terraform-ci SA email per env — used by infra-cd workflow."
  value = {
    for k, _ in var.envs :
    k => google_service_account.terraform_ci[k].email
  }
}

output "app_deployer_service_accounts" {
  description = "app-deployer SA email per env — used by app-cd workflow."
  value = {
    for k, _ in var.envs :
    k => google_service_account.app_deployer[k].email
  }
}
