# Infrastructure bootstrap

このディレクトリは **1 回だけ手で叩く** 部分を集めた場所です。ここで作る
ものを土台にして、後続の `infrastructure/envs/*` (Terragrunt) や CD
workflow が動きます。

何をやるか:

1. GCP プロジェクトに必要な API を有効化
2. Terraform の state を保管する GCS bucket を env 毎に作成
3. GitHub Actions が GCP に成り代わるための **Workload Identity
   Federation (WIF)** を構成
4. CI 用の Service Account を 2 種類 (terraform-ci, app-deployer) を env
   毎に作成し、必要 IAM を付与

ここを実行する人は **GCP プロジェクトに対する Owner 権限** が必要です。
JSON 鍵を一切作らない / 共有しない構成なので、実行後に手元に残る秘密鍵
はありません。

## 前提

- 3 つの GCP プロジェクトが作成済 (dev / stg / prod)
- 各プロジェクトに Billing account が link 済
- gcloud CLI と terraform >= 1.6.0 がローカルに入っている
- public repo 想定: project ID を README やコミットに残しても運用上問題
  ない値かを念のため確認 (組織の命名規則によっては変えてください)

プロジェクトをまだ作っていない場合は別途 Linear の人間オペプロジェクト
側 issue を参照してください。

## 手順

### 1. gcloud 認証

```bash
gcloud auth login
gcloud auth application-default login   # Terraform が ADC を使う
```

`application-default login` をやらないと Terraform 側で認証エラーになり
ます。

### 2. bootstrap script の実行 (API enable + state bucket)

`scripts/bootstrap.sh` の冒頭にある `ENVS` / `PROJECTS` / `REGION` を実
プロジェクト ID に合わせてください。デフォルトは:

```
ENVS:     (dev stg prod)
PROJECTS: (ai-hackathon-dev ai-hackathon-stg ai-hackathon-prod)
REGION:   asia-northeast1
```

実行:

```bash
./scripts/bootstrap.sh
```

成果物:

- 各プロジェクトで以下 API が有効化される
  - iam / iamcredentials / sts / cloudresourcemanager / serviceusage
  - storage / run / artifactregistry / cloudbuild
  - sqladmin / secretmanager / compute / vpcaccess / servicenetworking
- 各プロジェクトに `gs://tfstate-<project_id>` bucket
  - versioning 有効、uniform access、public access prevention

idempotent なので失敗しても再実行可能。

### 3. Terraform で WIF + Service Accounts を作る

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集 (project_id を実値に)

terraform init
terraform plan
terraform apply
```

terraform は **local state** で動かします (state bucket そのものを管理す
る側なので chicken-and-egg を避ける目的)。`terraform.tfstate` が
`terraform/` 配下に出来ますが、`.gitignore` 済なので push されません。
state には secret 値は載らないので消さずに保管しておけば OK。

成果物 (env 毎に 1 セット):

- Workload Identity Pool: `github-actions`
- Workload Identity Provider: `github` (issuer = GitHub OIDC)
  - `attribute.repository == "TakuoIshida/ai-hackathon"` を強制
  - 別の repo からは絶対に通らない
- Service Account `terraform-ci@<project>.iam.gserviceaccount.com`
  - infra-cd workflow から impersonate される
  - roles: storage.admin / run.admin / artifactregistry.admin /
    iam.serviceAccountAdmin / iam.workloadIdentityPoolAdmin /
    cloudsql.admin / secretmanager.admin / compute.networkAdmin /
    vpcaccess.admin / serviceusage.serviceUsageAdmin /
    resourcemanager.projectIamAdmin
- Service Account `app-deployer@<project>.iam.gserviceaccount.com`
  - app-cd workflow から impersonate される
  - roles: run.admin / iam.serviceAccountUser /
    artifactregistry.writer / secretmanager.secretAccessor /
    cloudsql.client / storage.objectViewer

### 4. terraform output の控え

apply の最後に出る output を控えてください:

```
workload_identity_providers = {
  "dev"  = "projects/.../locations/global/workloadIdentityPools/github-actions/providers/github"
  ...
}
terraform_ci_service_accounts = {
  "dev" = "terraform-ci@ai-hackathon-dev.iam.gserviceaccount.com"
  ...
}
app_deployer_service_accounts = {
  "dev" = "app-deployer@ai-hackathon-dev.iam.gserviceaccount.com"
  ...
}
```

技術的にはこれらは「鍵」ではなく、WIF + attribute_condition により別 repo
からは impersonate 不可なので、漏洩しても直接の損害はありません。とはい
え public repo の **最小情報原則** に従い、これらは Linear / Slack の
private channel で共有し、GitHub には Secrets として登録します (下記)。

### 5. GitHub の Environments / Secrets を設定

GitHub の `Settings → Environments` に `dev` / `stg` / `prod` を作り、
それぞれに **Environment secrets** として以下を登録:

| Secret name | 値 |
|---|---|
| `GCP_PROJECT_ID` | 各 env の project_id |
| `GCP_REGION` | `asia-northeast1` |
| `GCP_WIF_PROVIDER` | `workload_identity_providers` の値 |
| `GCP_TERRAFORM_CI_SA` | `terraform_ci_service_accounts` の値 |
| `GCP_APP_DEPLOYER_SA` | `app_deployer_service_accounts` の値 |

prod env には **Required reviewers** で承認者を設定 (人間 approval の
gate)。

**メモ**: 本来 GitHub の taxonomy ではこれらは Variables 相当の値だが、
public repo であることを踏まえ、defense in depth として Secrets に格納
する方針。Actions log では `***` で mask されるので、debug の際は
auth 結果を「コマンドが成功したか」で判定する (smoke workflow 参照)。

### 6. WIF smoke test

`.github/workflows/wif-smoke.yml` を `workflow_dispatch` で env=dev に
対して走らせ、`gcloud storage buckets list` が成功して `tfstate-*` bucket
が表示されれば疎通完了。stg / prod も同じく確認してください。SA email
そのものは Secret なので log では mask されます。

## トラブルシュート

- `Permission denied on bucket` → state bucket が無い、もしくは
  bootstrap.sh の region が tfstate bucket の region と違う
- `Failed to retrieve workload identity pool` → terraform apply 直後だ
  と数秒は反映ラグがある。1 分待つ
- `assertion.repository condition failed` → workflow を fork から動か
  していないか確認。fork は WIF 経由しないので OK (= 弾かれて正しい)
- gcloud で `403 SERVICE_DISABLED` → bootstrap.sh の API enable が止
  まっている。手動で
  `gcloud services enable <api> --project=<project>` を打ち直す

## state の取り扱い

- 本ディレクトリ Terraform の state は **local** (`terraform/terraform.tfstate`)
- `.gitignore` 済 — push されない
- 紛失しても再実行できるよう、resource は全て idempotent (import 不要)
- ただし Owner 権限が必要なので、紛失時は再 apply で再生成する想定

## 後続

ここが完了すると、`infrastructure/envs/dev/...` (Terragrunt) は
`gs://tfstate-ai-hackathon-dev` を backend として init できるようにな
ります (ISH-278 で構築)。
