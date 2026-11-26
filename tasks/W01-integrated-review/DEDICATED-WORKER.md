# Dedicated hosted worker

Run the existing worker on a supervised Linux host with Docker:

```sh
docker build -f infra/worker/Dockerfile -t student-creators-worker .
docker run --rm --env-file /secure/student-creators-worker.env student-creators-worker
```

Use a private background service, no public port, a secret store, restart-on-failure and at least 120 seconds graceful shutdown. Allow outbound HTTPS to the approved providers and ClamAV signature mirror. Start with at least 3 GB RAM and benchmark the real signature engine plus 100 MiB video workloads before production; 512 MB is not sufficient. The container runs as the non-root Node user, with no incoming network listener and a local Unix socket mode 0600.

The runtime requires explicit background and dedicated worker enablement and each provider's existing flags. Identity scanning additionally requires approved identity data policy and private identity storage. Media quarantine additionally requires its existing media policy gate, live Mux gate and private source storage. With either scanner enabled, the container obtains official malware signatures before starting clamd or the worker and stops if clamd or the signature updater exits. The worker uses bounded leases, sequential queue ticks, retry backoff and no secret-bearing logs. Do not enable the media or identity policy flags merely to get a green health check.

CI builds the container and executes a real ClamAV engine against a harmless synthetic signature for regression only. This does not prove official signature download, actual cloud worker readiness, provider acceptance or real data processing. None of those is complete until an authorized private worker host is provisioned and checked.

No live payment or payout enablement is performed by the Docker image. Do not deploy with a production environment file until the provider and legal gates are separately approved. Never commit that file.
