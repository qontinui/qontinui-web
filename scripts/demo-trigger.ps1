# PowerShell escape script for the coordination-layer demo trigger.
#
# Run this on PC if the /demo-control page itself regresses on
# the day of the demo. Spawns three agents directly via coord —
# no browser, no web backend dependency. Coord's /agents/allocate
# is anonymous in the pilot, so no JWT is needed at script-launch
# time; the response carries the agent JWT the runner picks up.
#
# Per plans/2026-05-18-coordination-layer-demos.md §5.2.3 (D5
# recovery path) and §7 ("operator inputs wrong command on stage").
#
# Usage:
#   .\demo-trigger.ps1 -PrimaryMachineId <pc-uuid> -SecondaryMachineId <msi-uuid>
#   .\demo-trigger.ps1 -PrimaryMachineId <pc-uuid> -SecondaryMachineId <msi-uuid> -ParentSha <sha>
#   .\demo-trigger.ps1 -PrimaryMachineId <pc-uuid> -SecondaryMachineId <msi-uuid> -CoordUrl https://coord.staging.qontinui.io
#
# Machine UUIDs are visible on /operations as the `machine_id`
# column of each runner card; copy them once and keep them in
# the demo runbook so this script is a single keystroke on the day.
#
# Compatible with Windows PowerShell 5.1 — no ThreadJob / advanced
# parallel constructs. Three sequential POSTs (~3s total) is well
# within the demo's "Trigger" beat budget (§3.3 30s).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PrimaryMachineId,

    [Parameter(Mandatory = $true)]
    [string]$SecondaryMachineId,

    [Parameter()]
    [string]$ParentSha = 'main',

    [Parameter()]
    [string]$CoordUrl = 'https://coord.staging.qontinui.io',

    [Parameter()]
    [string]$Repo = 'qontinui-web'
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Intent catalog — mirrors `DEMO_INTENTS` in demo-control/page.tsx and
# `DEMO_FEATURES` in operations/mergeTypes.ts. The three pre-authored
# feature specs live alongside the demo plan.
# ---------------------------------------------------------------------------

$intents = @(
    @{
        Slug   = 'profile'
        Branch = 'demo-feature-profile'
        Prompt = 'Implement plans/2026-05-18-coordination-layer-demos-feature-1-profile.md exactly. Single new file at qontinui-web/frontend/src/app/(app)/demo/profile/page.tsx. Commit on branch demo-feature-profile. POST /merge/propose when done.'
    },
    @{
        Slug   = 'fleet-pulse'
        Branch = 'demo-feature-fleet-pulse'
        Prompt = 'Implement plans/2026-05-18-coordination-layer-demos-feature-2-fleet-pulse.md exactly. Single new file at qontinui-web/frontend/src/app/(app)/demo/fleet-pulse/page.tsx. Commit on branch demo-feature-fleet-pulse. POST /merge/propose when done.'
    },
    @{
        Slug   = 'clock'
        Branch = 'demo-feature-clock'
        Prompt = 'Implement plans/2026-05-18-coordination-layer-demos-feature-3-clock.md exactly. Single new file at qontinui-web/frontend/src/app/(app)/demo/clock/page.tsx. Commit on branch demo-feature-clock. POST /merge/propose when done.'
    }
)

# ---------------------------------------------------------------------------
# Three sequential allocations: first two intents go to the primary
# machine, the third to the secondary. Order is preserved.
# ---------------------------------------------------------------------------

$results = @()
for ($i = 0; $i -lt $intents.Count; $i++) {
    $intent = $intents[$i]
    $machineId = if ($i -lt 2) { $PrimaryMachineId } else { $SecondaryMachineId }

    $body = @{
        machine_id = $machineId
        repos      = @(@{ repo = $Repo; parent_sha = $ParentSha })
        intent     = $intent.Prompt
    } | ConvertTo-Json -Depth 8 -Compress

    Write-Host ("[{0}/{1}] → allocating {2} on {3}…" -f `
            ($i + 1), $intents.Count, $intent.Slug, $machineId.Substring(0, 8))

    try {
        $resp = Invoke-RestMethod `
            -Uri "$CoordUrl/agents/allocate" `
            -Method Post `
            -ContentType 'application/json' `
            -Body $body `
            -TimeoutSec 30
        Write-Host ("    OK agent_id={0}  worktree={1}" -f `
                $resp.agent_id, $resp.worktrees[0].worktree_path) -ForegroundColor Green
        $results += [pscustomobject]@{
            Slug         = $intent.Slug
            Status       = 'success'
            AgentId      = $resp.agent_id
            WorktreePath = $resp.worktrees[0].worktree_path
        }
    }
    catch {
        Write-Host ("    FAIL {0}" -f $_.Exception.Message) -ForegroundColor Red
        $results += [pscustomobject]@{
            Slug   = $intent.Slug
            Status = 'error'
            Error  = $_.Exception.Message
        }
    }
}

Write-Host ''
Write-Host '--------------- results ---------------'
$results | Format-Table -AutoSize

$failures = @($results | Where-Object { $_.Status -ne 'success' })
if ($failures.Count -gt 0) {
    Write-Host ("FAIL {0} allocations failed" -f $failures.Count) -ForegroundColor Red
    exit 1
}
Write-Host 'OK all three agents allocated' -ForegroundColor Green
