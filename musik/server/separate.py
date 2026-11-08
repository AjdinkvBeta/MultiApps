"""Adskiller en sang i fire spor (vokal, trommer, bas, resten) på en GitHub-maskine.

Køres af .github/workflows/musik.yml på en gren "musik-job-<id>", som Musik-siden har oprettet.
Lyden er krypteret hele vejen, så intet kan høres i det offentlige repo:
  1. Maskinen laver et RSA-nøglepar og lægger den offentlige nøgle i musik-job/pub.b64.
  2. Siden krypterer sangen med en tilfældig AES-nøgle K og K med den offentlige nøgle (key.enc, in.enc).
  3. Maskinen dekrypterer, adskiller med HT-Demucs (ONNX, MIT) og lægger de fire spor krypteret med K tilbage.
  4. Siden henter sporene og sletter grenen.
"""
import base64, json, os, subprocess, sys, time, urllib.request

import numpy as np
import onnxruntime as ort
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BRANCH = os.environ["BRANCH"]
D = "musik-job"
MODEL_URL = "https://huggingface.co/adowu/htdemucs-onnx/resolve/main/htdemucs.onnx"
MODEL = os.path.expanduser("~/.cache/htdemucs/htdemucs.onnx")
N = 343980
OV = N // 4
STRIDE = N - OV
STEMS = ["drums", "bass", "other", "vocals"]
T0 = time.time()


def git(*a, check=True):
    return subprocess.run(["git", *a], check=check, capture_output=True, text=True)


def push(msg):
    git("add", "-A", D)
    if git("diff", "--cached", "--quiet", check=False).returncode == 0:
        return
    git("commit", "-qm", msg)
    for i in range(6):
        if git("push", "-q", "origin", f"HEAD:{BRANCH}", check=False).returncode == 0:
            return
        time.sleep(3 * (i + 1))
    raise RuntimeError("push fejlede")


def status(**kw):
    with open(f"{D}/prog.json", "w") as f:
        json.dump(kw, f)
    push("Musik: status")


def cleanup_old():
    """Slet gamle job-grene (over 3 timer), hvis siden ikke nåede at gøre det."""
    out = git("ls-remote", "--heads", "origin", "musik-job-*", check=False).stdout.split()
    now = time.time() * 1000
    for ref in out[1::2]:
        name = ref.replace("refs/heads/", "")
        if name == BRANCH:
            continue
        try:
            born = int(name.replace("musik-job-", "").split("-")[0], 36)
        except ValueError:
            continue
        if now - born > 3 * 3600 * 1000:
            git("push", "-q", "origin", "--delete", name, check=False)


def main():
    git("config", "user.name", "musik-bot")
    git("config", "user.email", "musik-bot@users.noreply.github.com")
    os.makedirs(D, exist_ok=True)

    # 1. Nøglepar – den private nøgle findes kun i denne maskines hukommelse
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    with open(f"{D}/pub.b64", "w") as f:
        f.write(base64.b64encode(pub).decode())
    push("Musik: klar")

    # Modellen hentes, mens siden sender sangen (gemmes i Actions-cachen)
    if not os.path.exists(MODEL):
        os.makedirs(os.path.dirname(MODEL), exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, MODEL + ".part")
        os.replace(MODEL + ".part", MODEL)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = os.cpu_count() or 2
    sess = ort.InferenceSession(MODEL, opts, providers=["CPUExecutionProvider"])
    cleanup_old()

    # 2. Vent på sangen
    deadline = time.time() + 15 * 60
    while not (os.path.exists(f"{D}/in.enc") and os.path.exists(f"{D}/key.enc")):
        if time.time() > deadline:
            raise RuntimeError("Sangen kom aldrig frem")
        time.sleep(4)
        git("pull", "-q", "--ff-only", "origin", BRANCH, check=False)
    k = key.decrypt(base64.b64decode(open(f"{D}/key.enc").read()),
                    padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    blob = open(f"{D}/in.enc", "rb").read()
    audio_in = AESGCM(k).decrypt(blob[:12], blob[12:], None)
    os.remove(f"{D}/in.enc")
    os.remove(f"{D}/key.enc")
    with open("/tmp/in.bin", "wb") as f:
        f.write(audio_in)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", "/tmp/in.bin", "-f", "f32le", "-ac", "2", "-ar", "44100", "-"],
                         check=True, capture_output=True).stdout
    mix = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()   # (2, n)
    total = mix.shape[1]
    print(f"Lyd: {total / 44100:.0f} s")

    # 3. Adskil i bidder på 7,8 s med 25 % overlap (som i HT-Demucs)
    win = np.minimum(1.0, np.minimum((np.arange(N) + 1) / (OV + 1), (N - np.arange(N)) / (OV + 1))).astype(np.float32)
    out = np.zeros((4, 2, total), dtype=np.float32)
    wsum = np.zeros(total, dtype=np.float32)
    chunks = max(1, -(-total // STRIDE))
    last = 0
    for c in range(chunks):
        st = c * STRIDE
        ln = min(N, total - st)
        if ln <= 0:
            break
        x = np.zeros((1, 2, N), dtype=np.float32)
        x[0, :, :ln] = mix[:, st:st + ln]
        y = sess.run(["stems"], {"mix": x})[0][0]                          # (4, 2, N)
        out[:, :, st:st + ln] += y[:, :, :ln] * win[:ln]
        wsum[st:st + ln] += win[:ln]
        done = (c + 1) / chunks
        if done - last >= 0.2 and c + 1 < chunks:
            last = done
            status(stage="sep", done=round(done, 2), sec=round(time.time() - T0))
    out /= np.maximum(wsum, 1e-8)

    # 4. Gem sporene som mp3, krypteret med K
    aes = AESGCM(k)
    for i, name in enumerate(STEMS):
        pcm = np.clip(out[i].T, -1, 1).astype(np.float32).tobytes()
        mp3 = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", "44100", "-ac", "2", "-i", "-",
                              "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "-"], input=pcm, check=True, capture_output=True).stdout
        iv = os.urandom(12)
        with open(f"{D}/{name}.enc", "wb") as f:
            f.write(iv + aes.encrypt(iv, mp3, None))
    with open(f"{D}/done.json", "w") as f:
        json.dump({"ok": True, "sec": round(time.time() - T0), "len": total}, f)
    if os.path.exists(f"{D}/prog.json"):
        os.remove(f"{D}/prog.json")
    push("Musik: færdig")
    print(f"Færdig på {time.time() - T0:.0f} s")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # siden skal vide det, i stedet for at vente forgæves
        print("Fejl:", e, file=sys.stderr)
        os.makedirs(D, exist_ok=True)
        with open(f"{D}/done.json", "w") as f:
            json.dump({"ok": False, "err": str(e)[:300]}, f)
        try:
            push("Musik: fejl")
        except Exception:
            pass
        sys.exit(1)
