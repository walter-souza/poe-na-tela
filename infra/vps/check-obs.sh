#!/usr/bin/env bash
# Valida o stream do OBS que chega ao MediaMTX (resolução, bitrate, perda SRT e descartes).
# Roda na VPS, lendo a API local do MediaMTX (127.0.0.1:9997). A partir da sua máquina:
#   ssh vps 'bash -s' < infra/vps/check-obs.sh              # todos os streams
#   ssh vps 'bash -s -- teste/Walter 20' < infra/vps/check-obs.sh   # um caminho, janela de 20 s
# O fps NÃO aparece aqui (o MediaMTX não o expõe): meça no espectador (veja README).
set -euo pipefail

PATH_FILTER="${1:-}"
WINDOW="${2:-10}"
API="${MEDIAMTX_API:-http://127.0.0.1:9997}"

python3 - "$API" "$PATH_FILTER" "$WINDOW" <<'PY'
import json, sys, time, urllib.request

api, path_filter, window = sys.argv[1], sys.argv[2], float(sys.argv[3])

def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.load(r)

def conns():
    return {c["path"]: c for c in get(f"{api}/v3/srtconns/list").get("items", []) if c.get("state") == "publish"}

def wanted(d):
    return {p: c for p, c in d.items() if not path_filter or p == path_filter}

first = wanted(conns())
if not first:
    print("Nenhum publicador SRT ativo" + (f" em '{path_filter}'" if path_filter else "") + ". O OBS está transmitindo?")
    sys.exit(2)

print(f"Amostrando {window:.0f}s...")
time.sleep(window)
second = wanted(conns())

worst = 0  # 0 = ok, 1 = atenção, 2 = problema
def flag(level, msg):
    global worst
    worst = max(worst, level)
    print(("  [OK]      ", "  [ATENÇÃO] ", "  [PROBLEMA]")[level] + " " + msg)

for path, b in second.items():
    a = first.get(path)
    if not a:
        continue
    print(f"\n== {path} ==")

    track = next((t for t in get(f"{api}/v3/paths/get/{path}").get("tracks2", []) if t["codec"] in ("H264", "H265", "AV1", "VP9")), None)
    if track:
        w, h = track["codecProps"].get("width", 0), track["codecProps"].get("height", 0)
        print(f"  Vídeo: {track['codec']} {w}x{h}")
        if h < 1080:
            flag(1, f"altura {h} < 1080 (não é Full HD)")
        elif w * 9 != h * 16:
            flag(0, f"{w}x{h} não é 16:9 (monitor ultrawide?), mas tem ≥ 1080 de altura")
        else:
            flag(0, "resolução Full HD ou superior")

    rate = b.get("mbpsReceiveRate", 0)
    rtt = b.get("msRTT", 0)
    print(f"  Taxa recebida: {rate:.2f} Mbps | RTT: {rtt:.0f} ms | buffer SRT: {b.get('msReceiveTsbPdDelay')} ms")
    flag(1 if rate > 8 else 0, f"bitrate {rate:.1f} Mbps" + (" (alto: use CBR ~6000 kbps no OBS)" if rate > 8 else ""))

    d = lambda k: max(0, b.get(k, 0) - a.get(k, 0))
    recv, lost, retrans, drop = d("packetsReceived"), d("packetsReceivedLoss"), d("packetsReceivedRetrans"), d("packetsReceivedDrop")
    tot = recv + lost
    loss_pct = 100 * lost / tot if tot else 0
    drop_pct = 100 * drop / tot if tot else 0
    print(f"  Janela de {window:.0f}s: {tot} pacotes, {lost} perdidos ({loss_pct:.2f}%), {retrans} retransmitidos, {drop} descartados ({drop_pct:.2f}%)")
    flag(2 if loss_pct > 3 else 1 if loss_pct > 1 else 0, f"perda no uplink {loss_pct:.2f}%")
    flag(2 if drop_pct > 0.5 else 1 if drop_pct > 0.1 else 0, f"descartes por atraso {drop_pct:.2f}%" + (" (aumente &latency= na URL do OBS)" if drop_pct > 0.1 else ""))

    latency = b.get("msReceiveTsbPdDelay", 0)
    need = max(120, 4 * rtt) if loss_pct < 1 else max(250, 5 * rtt)
    if latency < need:
        flag(1, f"buffer SRT {latency} ms abaixo do sugerido (~{need:.0f} ms): use &latency={int(need * 1000)} na URL")

print("\nVeredito:", ("OK", "ATENÇÃO", "PROBLEMA")[worst])
sys.exit(worst)
PY
