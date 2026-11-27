# Dedicated worker operational checks

Build from repository root: `docker build -f infra/worker/Dockerfile -t student-creators-worker .`. Supply approved server-only environment through the hosting secret manager, not the image or committed files. Enable only approved job flags. Dedicated startup eagerly validates enabled Paystack, LiveKit and Mux client configuration without initiating provider actions; identity, media and payout construction remains gated. Successful configuration is not provider acceptance.

The container writes a redacted atomic heartbeat under /run/student-creators (private to the non-root worker). The Docker healthcheck uses scripts/check-worker-health.mjs: exit 0 means a completed tick occurred within 480 seconds, exit 1 means starting, missing, invalid or stale heartbeat. The JSON ready field distinguishes a complete healthy tick from a degraded tick. Monitor ready=false separately, as expected queue retries must not cause restart loops. No job identifiers, credentials or provider response bodies appear in the heartbeat. Shutdown removes the file; a crash becomes stale. Initial scanner signature download can take up to 20 minutes; healthcheck has a 22-minute start period. The eight-minute threshold covers a previously admitted media job (bounded scanner, object download, provider dispatch and RPCs) plus scheduling backoff. The 45-second scheduler budget limits admission of additional work, not the duration of an in-flight provider operation; never abandon an uncertain transfer by racing it against that budget. A stale heartbeat is not proof a provider action failed. Database leases and provider reconciliation remain authoritative. The local heartbeat does not prove external service delivery or a distributed heartbeat.

Do not share heartbeat volumes across replicas. Database leases remain authoritative for concurrent work. Deploy only to an approved worker runtime with an actual restart policy, secure credentials, ClamAV signatures, and readiness alerting. Verify actual host health and queue progress separately. No approval flags should be changed solely to make a health check green.

Enable `STUDENT_CREATORS_AUTH_RECOVERY_WORKER_ENABLED=true` only with the existing hosted auth and email gates and required secrets configured. The dedicated worker now consumes the existing durable recovery queue; a requested provider recovery is not proof of email delivery, and uncertain requests are review outcomes rather than immediate resend attempts. The standalone recovery command remains available for operator use under its existing gate. All eight queues fit the bounded scheduler.

## Oracle Ampere A1 deployment acceptance

Use an ARM64 Ubuntu LTS host in the approved tenancy, initially 2 OCPUs, 8 GiB RAM and 50 GB boot storage. Check actual Always Free entitlement and capacity in the console before provisioning. Restrict SSH to authorized operator addresses, use SSH keys only, do not publish container ports, and permit outbound HTTPS for approved providers and official ClamAV signatures. Oracle free instances may be reclaimed: preserve deployment configuration and secrets independently, and monitor host reachability.

The ARM64 CI workflow builds the actual worker image on a native ARM runner and verifies the non-root process, ClamAV regression and heartbeat guard. It is not a substitute for measuring real signature memory, queue processing or cloud availability.

On the provisioned host, from the reviewed commit and with a root-owned mode-0600 environment file outside the checkout:
```sh
sudo docker build -f infra/worker/Dockerfile -t student-creators-worker:reviewed .
sudo docker run -d --name student-creators-worker --restart unless-stopped \
  --stop-timeout 120 --env-file /etc/student-creators/worker.env \
  student-creators-worker:reviewed
sudo docker inspect --format '{{.State.Health.Status}}' student-creators-worker
sudo docker exec student-creators-worker node scripts/check-worker-health.mjs
```
Do not display the environment file or unrestricted container inspection output. Review approved job flags before starting; never enable transfers or live charges as a deployment test. Docker restart policies handle process exits, not unhealthy-but-running containers; alert and investigate stale/degraded heartbeat rather than blindly restarting a potentially in-flight financial operation. Record image architecture, exact Git revision, actual signature initialization, CPU/RAM usage, health and each approved queue's progress before accepting this host. Production acceptance remains pending until that evidence exists.
