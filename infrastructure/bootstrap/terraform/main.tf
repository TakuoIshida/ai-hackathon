locals {
  envs = var.envs

  terraform_ci_roles = [
    "roles/storage.admin",
    "roles/run.admin",
    "roles/artifactregistry.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.workloadIdentityPoolAdmin",
    "roles/cloudsql.admin",
    "roles/secretmanager.admin",
    "roles/compute.networkAdmin",
    "roles/vpcaccess.admin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/resourcemanager.projectIamAdmin",
  ]

  app_deployer_roles = [
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/artifactregistry.writer",
    "roles/secretmanager.secretAccessor",
    "roles/cloudsql.client",
    "roles/storage.objectViewer",
  ]

  ci_sa_role_pairs = merge([
    for env_name, _ in local.envs : merge(
      {
        for role in local.terraform_ci_roles :
        "${env_name}|tf|${role}" => { env = env_name, sa = "tf", role = role }
      },
      {
        for role in local.app_deployer_roles :
        "${env_name}|app|${role}" => { env = env_name, sa = "app", role = role }
      },
    )
  ]...)
}

resource "google_iam_workload_identity_pool" "gh" {
  for_each                  = local.envs
  project                   = each.value.project_id
  workload_identity_pool_id = var.wif_pool_id
  display_name              = "GitHub Actions"
  description               = "Federated identity pool for GitHub Actions workflows"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  for_each                           = local.envs
  project                            = each.value.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.gh[each.key].workload_identity_pool_id
  workload_identity_pool_provider_id = var.wif_provider_id
  display_name                       = "GitHub OIDC"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"
    "attribute.actor"            = "assertion.actor"
    "attribute.workflow"         = "assertion.workflow"
  }

  attribute_condition = "attribute.repository == \"${var.github_repository}\""
}

resource "google_service_account" "terraform_ci" {
  for_each     = local.envs
  project      = each.value.project_id
  account_id   = "terraform-ci"
  display_name = "Terraform CI (GitHub Actions)"
  description  = "Used by infra-cd workflow to run terraform plan/apply"
}

resource "google_service_account" "app_deployer" {
  for_each     = local.envs
  project      = each.value.project_id
  account_id   = "app-deployer"
  display_name = "App Deployer (GitHub Actions)"
  description  = "Used by app-cd workflow to push images and deploy Cloud Run revisions"
}

resource "google_project_iam_member" "ci_roles" {
  for_each = local.ci_sa_role_pairs

  project = local.envs[each.value.env].project_id
  role    = each.value.role
  member = (
    each.value.sa == "tf"
    ? "serviceAccount:${google_service_account.terraform_ci[each.value.env].email}"
    : "serviceAccount:${google_service_account.app_deployer[each.value.env].email}"
  )
}

resource "google_service_account_iam_member" "tf_wif_binding" {
  for_each = local.envs

  service_account_id = google_service_account.terraform_ci[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.gh[each.key].name}/attribute.repository/${var.github_repository}"
}

resource "google_service_account_iam_member" "app_wif_binding" {
  for_each = local.envs

  service_account_id = google_service_account.app_deployer[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.gh[each.key].name}/attribute.repository/${var.github_repository}"
}
