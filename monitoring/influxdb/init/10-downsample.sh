#!/bin/bash
# 1분 집계 버킷(90일) + 다운샘플링 작업 — 원시값(raw)은 7일만 보관하고, 오래된 추세는 1분 평균으로 본다
set -e
influx bucket create --name agg_1m --retention 90d --org metafactory
cat > /tmp/mf-downsample.flux <<'FLUX'
option task = {name: "mf-downsample-1m", every: 1m, offset: 15s}
from(bucket: "raw")
  |> range(start: -task.every)
  |> filter(fn: (r) => r._measurement == "equipment" or r._measurement == "sensor" or r._measurement == "machine")
  |> filter(fn: (r) => r._field != "state" and r._field != "decision")
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> to(bucket: "agg_1m", org: "metafactory")
FLUX
influx task create --org metafactory --file /tmp/mf-downsample.flux
