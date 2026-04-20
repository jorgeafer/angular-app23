## GitHub Actions Deploy

This repository includes a workflow that deploys to the AWS EC2 server on every push to `main`.

Configure these before enabling it:

- Repository secret `EC2_HOST`: the public IP or DNS of the EC2 instance.
- Repository secret `EC2_USER`: the SSH user, for example `ubuntu`.
- Repository secret `EC2_SSH_PRIVATE_KEY`: the private key contents used by GitHub Actions to SSH into the instance.
- Repository secret `EC2_HOST_FINGERPRINT`: the server SSH host fingerprint in `SHA256:...` format.
- Repository variable `EC2_APP_DIR`: the repository path on the server, for example `/home/ubuntu/angular-app23`.

The workflow expects:

- the app folder on the instance at `$EC2_APP_DIR/angular-app`
- `pm2` installed and managing the process name `angular-app23-api`
- `nginx` installed and reloadable with `sudo systemctl reload nginx`
