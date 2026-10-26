#!/bin/bash
# Keeps retrying an Always Free Ampere A1 launch until Oracle has capacity
# ("Out of host capacity" is normal in busy regions; capacity frees up at
# random). Tries 2 OCPU / 12 GB, then 1 / 6, across all fault domains. A 1/6
# instance can be resized up to 2/12 later from the console, still free.
#
# Needs the OCI CLI, configured once with `oci setup config` (API key), and:
#   TENANCY_OCID  Profile -> Tenancy -> OCID (also used as the compartment)
#   SUBNET_OCID   a PUBLIC subnet: Networking -> VCN wizard ->
#                 "Create VCN with Internet Connectivity" -> public subnet OCID
#   SSH_PUBKEY    path to your public key (default ~/.ssh/id_ed25519.pub)
#
# Usage: TENANCY_OCID=ocid1.tenancy... SUBNET_OCID=ocid1.subnet... ./launch-a1.sh
set -uo pipefail
: "${TENANCY_OCID:?}" "${SUBNET_OCID:?}"
SSH_PUBKEY=${SSH_PUBKEY:-$HOME/.ssh/id_ed25519.pub}
[ -f "$SSH_PUBKEY" ] || { echo "No SSH public key at $SSH_PUBKEY"; exit 1; }

# Half the free allowance first (gets placed far more often than 4/24), then 1/6.
SHAPES=('{"ocpus":2,"memoryInGBs":12}' '{"ocpus":1,"memoryInGBs":6}')
WAIT=60

AD=$(oci iam availability-domain list --compartment-id "$TENANCY_OCID" \
  --query 'data[0].name' --raw-output) || exit 1
IMAGE=$(oci compute image list --compartment-id "$TENANCY_OCID" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output) || exit 1
echo "AD: $AD"
echo "Image: $IMAGE (Ubuntu 24.04 aarch64)"

attempt=0
while true; do
  for shape in "${SHAPES[@]}"; do
    for fd in FAULT-DOMAIN-1 FAULT-DOMAIN-2 FAULT-DOMAIN-3; do
      attempt=$((attempt + 1))
      printf '[%s] #%d %s %s ... ' "$(date +%H:%M:%S)" "$attempt" "$shape" "$fd"
      out=$(oci compute instance launch \
        --availability-domain "$AD" --fault-domain "$fd" \
        --compartment-id "$TENANCY_OCID" --subnet-id "$SUBNET_OCID" \
        --shape VM.Standard.A1.Flex --shape-config "$shape" \
        --image-id "$IMAGE" --boot-volume-size-in-gbs 100 \
        --assign-public-ip true --ssh-authorized-keys-file "$SSH_PUBKEY" \
        --display-name connect-media 2>&1)
      if [ $? -eq 0 ]; then
        echo "LAUNCHED"
        echo "$out" | grep -E '"id"|"shape-config"|"lifecycle-state"' | head -5
        echo "Next: Console -> Instances -> connect-media -> reserve its public IP."
        exit 0
      fi
      case "$out" in
        *"Out of host capacity"*) echo "no capacity" ;;
        *TooManyRequests*) echo "rate limited, backing off"; sleep 120 ;;
        *LimitExceeded*|*QuotaExceeded*)
          echo "limit exceeded — an A1 instance may already exist (free tier = 4 OCPU total)"
          exit 1 ;;
        *) echo "unexpected error:"; echo "$out" | tail -5; exit 1 ;;
      esac
      sleep 5
    done
  done
  sleep "$WAIT"
done
