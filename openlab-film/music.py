"""Original 20-second soundtrack for the Busandong Open Lab film.

Everything is synthesized from scratch (no samples): 120 BPM, F major.
The arrangement is locked to the same timeline as film.js so every cut,
slam and stamp in the picture lands on a musical hit.

Outputs:
  build/audio.wav            48 kHz / 16-bit stereo master
  build/audio_features.json  per-video-frame RMS + log-band spectrum (60 fps)
"""
import json
import os

import numpy as np
from scipy import signal

SR = 48000
DUR = 44.0
FPS = 60
N = int(SR * DUR)
PAD = SR * 4  # room for reverb tails beyond the end
rng = np.random.default_rng(7)

BEAT = 0.5
S16 = BEAT / 4

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build")
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- utilities
def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


class Bus:
    def __init__(self):
        self.L = np.zeros(N + PAD)
        self.R = np.zeros(N + PAD)

    def add(self, t0, x, pan=0.0, gain=1.0):
        i = int(round(t0 * SR))
        if i < 0:
            x = x[-i:]
            i = 0
        n = min(len(x), len(self.L) - i)
        if n <= 0:
            return
        a = (pan + 1) * np.pi / 4
        self.L[i:i + n] += x[:n] * np.cos(a) * gain
        self.R[i:i + n] += x[:n] * np.sin(a) * gain

    def add_st(self, t0, l, r, gain=1.0):
        i = int(round(t0 * SR))
        n = min(len(l), len(self.L) - i)
        self.L[i:i + n] += l[:n] * gain
        self.R[i:i + n] += r[:n] * gain


drums, bass_bus, synth, fx, verb = Bus(), Bus(), Bus(), Bus(), Bus()


def send(bus, t0, x, pan=0.0, gain=1.0, rev=0.0):
    bus.add(t0, x, pan, gain)
    if rev:
        verb.add(t0, x, pan, gain * rev)


def sos(btype, fc, order=2):
    fc = np.clip(fc, 20, SR / 2 * 0.95)
    return signal.butter(order, fc, btype=btype, fs=SR, output="sos")


def filt(x, btype, fc, order=2):
    return signal.sosfilt(sos(btype, fc, order), x)


def tv_filter(x, fc_fn, btype="lowpass", blk=256, order=2):
    """Time-varying Butterworth filter (block-wise coefficients, carried state)."""
    y = np.zeros_like(x)
    zi = None
    for s in range(0, len(x), blk):
        fc = fc_fn(s / SR)
        if btype == "bandpass":
            lo, hi = fc
            sc = sos("bandpass", [lo, hi], order)
        else:
            sc = sos(btype, fc, order)
        if zi is None or zi.shape != (sc.shape[0], 2):
            zi = np.zeros((sc.shape[0], 2))
        y[s:s + blk], zi = signal.sosfilt(sc, x[s:s + blk], zi=zi)
    return y


def polyblep_saw(freq, n):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = np.cumsum(dt) + rng.random()
    ph %= 1.0
    saw = 2 * ph - 1
    m1 = ph < dt
    x = ph[m1] / dt[m1]
    saw[m1] -= x + x - x * x - 1
    m2 = ph > 1 - dt
    x = (ph[m2] - 1) / dt[m2]
    saw[m2] -= x * x + x + x + 1
    return saw


def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * np.cumsum(f) / SR + phase)


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1, hold=None):
    """hold: seconds before release starts (defaults to full length minus r)."""
    t = np.arange(n) / SR
    total = n / SR
    hold = total - r if hold is None else hold
    env = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return env * (1 - rel) ** 2


def noise(n):
    return rng.standard_normal(n)


# ---------------------------------------------------------------- instruments
def kick(t0, lvl=1.0):
    t = tt(0.5)
    f = 44 + 150 * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.26)
    click = filt(noise(len(t)), "highpass", 2500) * np.exp(-t / 0.004) * 0.5
    x = np.tanh(1.8 * (body + click)) * 0.95
    send(drums, t0, x, 0, lvl)


def clap(t0, lvl=1.0):
    t = tt(0.4)
    n = noise(len(t))
    env = np.zeros(len(t))
    for k, off in enumerate([0, 0.010, 0.021]):
        env += np.where(t >= off, np.exp(-(t - off) / 0.006), 0) * (0.8 + 0.1 * k)
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.11), 0) * 0.55
    x = filt(n, "bandpass", [900, 3200]) * env
    send(drums, t0, x * 0.9, 0.05, lvl, rev=0.35)


def snare(t0, lvl=1.0, rev=0.25):
    t = tt(0.3)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.6
    nz = filt(noise(len(t)), "bandpass", [1500, 9000]) * np.exp(-t / 0.09)
    send(drums, t0, (tone + nz) * 0.7, -0.05, lvl, rev=rev)


def hat(t0, lvl=1.0, open_=False):
    t = tt(0.3 if open_ else 0.08)
    x = filt(noise(len(t)), "highpass", 7500) * np.exp(-t / (0.09 if open_ else 0.018))
    send(drums, t0, x * 0.35, 0.25 if open_ else -0.2, lvl, rev=0.05)


def tom(t0, lvl=1.0, f0=120):
    t = tt(0.4)
    f = f0 * (1 + 0.6 * np.exp(-t / 0.03))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    send(drums, t0, np.tanh(1.5 * x) * 0.6, 0.1, lvl, rev=0.2)


def bass(t0, dur, midi, lvl=1.0, cutoff=900, glide_to=None):
    n = int((dur + 0.08) * SR)
    f = np.full(n, mtof(midi))
    if glide_to is not None:
        f = mtof(midi + (glide_to - midi) * np.clip(np.arange(n) / n * 1.5, 0, 1))
    saw = polyblep_saw(f, n)
    sub = sine(f, n)
    x = filt(saw, "lowpass", cutoff) * 0.55 + sub * 0.75
    x *= adsr(n, 0.004, 0.18, 0.6, 0.06, hold=dur)
    send(bass_bus, t0, np.tanh(1.4 * x) * 0.55, 0, lvl)


def supersaw(t0, dur, midis, lvl=1.0, cutoff=3000, a=0.01, d=0.25, s=0.55, r=0.12,
             voices=7, spread=0.16, rev=0.25, bus=None, cutoff_fn=None):
    n = int((dur + r) * SR)
    L = np.zeros(n)
    R = np.zeros(n)
    for m in midis:
        for v in range(voices):
            det = (v - (voices - 1) / 2) / ((voices - 1) / 2) * spread
            x = polyblep_saw(mtof(m + det), n)
            p = (v / (voices - 1)) * 2 - 1
            ang = (p * 0.85 + 1) * np.pi / 4
            L += x * np.cos(ang)
            R += x * np.sin(ang)
    norm = 1.0 / (len(midis) * voices) ** 0.5
    env = adsr(n, a, d, s, r, hold=dur)
    if cutoff_fn is None:
        L = filt(L, "lowpass", cutoff)
        R = filt(R, "lowpass", cutoff)
    else:
        L = tv_filter(L, cutoff_fn)
        R = tv_filter(R, cutoff_fn)
    L *= env * norm * 0.35
    R *= env * norm * 0.35
    (bus or synth).add_st(t0, L, R, lvl)
    if rev:
        verb.add_st(t0, L, R, lvl * rev)


def pluck(t0, midi, dur=0.35, lvl=1.0, bright=6000, pan=0.0, rev=0.3, delay=True, freq=None):
    n = int(dur * SR)
    f = mtof(midi) if freq is None else freq[:n]
    x = polyblep_saw(f, n) * 0.6 + np.sign(sine(f, n)) * 0.25
    t = np.arange(n) / SR
    x = tv_filter(x, lambda s: 300 + bright * np.exp(-s / 0.07))
    x *= np.exp(-t / (dur * 0.35)) * np.minimum(1, t / 0.002)
    send(synth, t0, x * 0.45, pan, lvl, rev=rev)
    if delay:  # dotted-eighth ping-pong
        for k in range(1, 4):
            send(fx, t0 + k * 0.375, x * 0.45 * (0.38 ** k), pan=(-0.6 if k % 2 else 0.6), gain=lvl, rev=rev)


def bell(t0, midi, dur=1.6, lvl=1.0, pan=0.0, rev=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    fc = mtof(midi)
    idx = 3.0 * np.exp(-t / 0.25)
    mod = np.sin(2 * np.pi * fc * 3.5 * t) * idx
    x = np.sin(2 * np.pi * fc * t + mod) * np.exp(-t / (dur * 0.3))
    x += np.sin(2 * np.pi * fc * 2 * t) * np.exp(-t / 0.2) * 0.2
    send(synth, t0, x * 0.28 * np.minimum(1, t / 0.001), pan, lvl, rev=rev)


def whoosh(t0, dur=0.35, lvl=1.0, lo=250, hi=7000, up=True, pan_from=-0.7, pan_to=0.7):
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = t / dur

    def fc_fn(s):
        k = s / dur if up else 1 - s / dur
        c = lo * (hi / lo) ** np.clip(k, 0, 1)
        return (c * 0.7, min(c * 1.4, SR / 2 * 0.9))

    x = tv_filter(noise(n), fc_fn, "bandpass")
    env = np.sin(np.pi * np.clip(u, 0, 1) ** 0.7) ** 2
    x *= env * 0.9
    pans = pan_from + (pan_to - pan_from) * u
    a = (pans + 1) * np.pi / 4
    fx.add_st(t0, x * np.cos(a), x * np.sin(a), lvl)
    verb.add_st(t0, x * np.cos(a), x * np.sin(a), lvl * 0.2)


def riser(t0, dur, lvl=1.0, m0=48, m1=86):
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = t / dur
    nz = tv_filter(noise(n), lambda s: 400 * (12000 / 400) ** (s / dur), "highpass")
    f = mtof(m0 + (m1 - m0) * u ** 1.6)
    tone = polyblep_saw(f, n) + polyblep_saw(f * 1.006, n)
    tone = filt(tone, "lowpass", 5000) * 0.25
    env = u ** 2.2
    x = (nz * 0.5 + tone) * env
    send(fx, t0, x * 0.5, 0, lvl, rev=0.3)


def reverse_cymbal(t_end, dur, lvl=1.0):
    n = int(dur * SR)
    u = np.arange(n) / n
    x = filt(noise(n), "highpass", 5000) * u ** 3
    send(fx, t_end - dur, x * 0.45, 0.2, lvl, rev=0.3)


def impact(t0, lvl=1.0, sub_f=52):
    t = tt(2.5)
    f = sub_f * (1 + 1.4 * np.exp(-t / 0.05))
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    crash = filt(noise(len(t)), "highpass", 3500) * np.exp(-t / 0.8) * 0.22
    body = filt(noise(len(t)), "lowpass", 600) * np.exp(-t / 0.08) * 0.7
    x = np.tanh(1.6 * (sub + body)) * 0.9 + crash
    send(fx, t0, x, 0, lvl, rev=0.45)


def blip(t0, f=1760, dur=0.05, lvl=1.0, pan=0.0):
    t = tt(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / (dur * 0.4)) * np.minimum(1, t / 0.001)
    send(fx, t0, x * 0.25, pan, lvl, rev=0.2)


def click(t0, lvl=1.0, lo=2000, hi=6000, dur=0.006, pan=0.0):
    t = tt(0.02)
    x = filt(noise(len(t)), "bandpass", [lo, hi]) * np.exp(-t / dur)
    send(fx, t0, x * 0.5, pan, lvl)


def bloop(t0, f0=400, lvl=1.0, pan=0.0):
    t = tt(0.07)
    f = f0 * (1 + 2.5 * t / 0.07)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.07)
    send(fx, t0, x * 0.22, pan, lvl, rev=0.2)


def thunk(t0, lvl=1.0):
    t = tt(0.25)
    body = np.sin(2 * np.pi * np.cumsum(95 * (1 + 0.8 * np.exp(-t / 0.01))) / SR) * np.exp(-t / 0.07)
    wood = filt(noise(len(t)), "bandpass", [300, 1400]) * np.exp(-t / 0.025)
    send(fx, t0, np.tanh(2 * (body + wood * 0.8)) * 0.7, 0, lvl, rev=0.15)


def tape_rip(t0, dur=0.22, lvl=1.0, pan=0.0):
    """Tape tear: noise chopped by a decelerating sawtooth AM through a falling band."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    rate = 140 * np.exp(-t / (dur * 0.45)) + 18
    chop = (np.cumsum(rate) / SR) % 1.0
    am = (1 - chop) ** 3
    x = tv_filter(noise(n), lambda s: (max(250, 3800 * np.exp(-s / (dur * 0.5))),
                                       max(900, 9000 * np.exp(-s / (dur * 0.6)))), "bandpass")
    x = np.tanh(3 * x * am) * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.4
    send(fx, t0, x * 0.5, pan, lvl, rev=0.12)


def metal(t0, f0=420, dur=1.4, lvl=1.0, pan=0.0, rev=0.45):
    """Struck metal plate: inharmonic partials with individual decays."""
    t = tt(dur)
    x = np.zeros(len(t))
    for ratio, amp, dec in [(1, 1, 0.9), (2.76, 0.6, 0.55), (5.40, 0.45, 0.35),
                            (8.93, 0.3, 0.22), (13.34, 0.2, 0.14), (1.51, 0.35, 0.7)]:
        x += np.sin(2 * np.pi * f0 * ratio * t + rng.random() * 6) * amp * np.exp(-t / (dur * dec * 0.5))
    x += filt(noise(len(t)), "highpass", 4000) * np.exp(-t / 0.01) * 0.6
    send(fx, t0, x * 0.16, pan, lvl, rev=rev)


def compress(L, R, thresh_db=-16.0, ratio=3.0, att=0.004, rel=0.09, knee=6.0):
    """Stereo-linked feed-forward RMS compressor with soft knee (sample loop)."""
    det = np.maximum(np.abs(L), np.abs(R))
    det = np.sqrt(filt(det ** 2, "lowpass", 400, order=1).clip(1e-12))
    lvl_db = 20 * np.log10(det + 1e-9)
    over = lvl_db - thresh_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    a_att = np.exp(-1 / (att * SR))
    a_rel = np.exp(-1 / (rel * SR))
    env = np.empty_like(gr)
    e = 0.0
    for i, g in enumerate(gr):
        e = a_att * e + (1 - a_att) * g if g > e else a_rel * e + (1 - a_rel) * g
        env[i] = e
    gain = 10 ** (-env / 20)
    return L * gain, R * gain


# ---------------------------------------------------------------- harmony
def voicing(pcs, lo=55, top=True):
    out = []
    for pc in pcs:
        m = lo + ((pc - lo) % 12)
        out.append(m)
    out.sort()
    if top:
        out.append(out[0] + 12)
    return out


F, G, A, Bb, C, D, E = 5, 7, 9, 10, 0, 2, 4
CH = {
    "Fmaj7": [F, A, C, E], "Bbmaj7": [Bb, D, F, A], "F": [F, A, C], "C": [C, E, G],
    "Dm": [D, F, A], "Bb": [Bb, D, F], "Gm7": [G, Bb, D, F], "Csus4": [C, F, G],
    "Fadd9": [F, A, C, G], "Bbadd9": [Bb, D, F, C], "Dm7": [D, F, A, C],
}
ROOT = {"Fmaj7": 41, "Bbmaj7": 46, "F": 41, "C": 36, "Dm": 38, "Bb": 46, "Gm7": 43,
        "Csus4": 36, "Fadd9": 41, "Bbadd9": 46, "Dm7": 38}

# bar index -> chord (bar i starts at 2*i seconds)
BARS = ["Fmaj7", "Bbmaj7", "F", "C", "Dm", "Bb", "Gm7", "C", "Fadd9", "Fadd9"]

# ---------------------------------------------------------------- arrangement
# Bar i spans [2i, 2i+2). Timeline shared with film.js:
#  0 intro | 1-2 school bento | 3 "오늘의 탐구가" | 4-11 booth cards | 12 grid
#  13 "내일의 가능성이" | 14-15 admissions | 16 stamps | 17 build | 18-19 title+info | 20-21 end
kick_times = []
HAT_ACC = [0.55, 0.25, 0.9, 0.3]


def kicks(b0, beats=(0, 1, 2, 3), lvl=1.0):
    for b in beats:
        kick(b0 + b * BEAT, lvl)
        kick_times.append(b0 + b * BEAT)


def hats16(b0, lvl=0.7, n=16):
    for k in range(n):
        hat(b0 + k * S16, HAT_ACC[k % 4] * lvl, open_=(k % 4 == 2))


def hats8off(b0, lvl=0.7):
    for k in range(4):
        hat(b0 + k * BEAT + 0.25, lvl, open_=True)


def bassline(b0, ch, steps=(0, 2, 6, 8, 10, 12, 14), up=(2, 10), cutoff=1000, lvl=1.0):
    for st in steps:
        bass(b0 + st * S16, 0.2, ROOT[ch] + (12 if st in up else 0), lvl, cutoff=cutoff)


def pad(b0, ch, dur=2.0, lvl=0.3, cutoff=1300, lo=48):
    supersaw(b0, dur, voicing(CH[ch], lo, top=False), lvl=lvl, cutoff=cutoff, a=0.05, s=0.9, r=0.1, rev=0.3)


def stab(t0, ch, lo=60, lvl=0.8, cutoff=4200):
    supersaw(t0, 0.24, voicing(CH[ch], lo), lvl=lvl, cutoff=cutoff, d=0.1, s=0.25)


def pop(t0, ch, k=0):
    """card pop: stab + tom + count-up ticks"""
    stab(t0, ch, 58 + k, 0.8)
    tom(t0, 0.45, 95 + 18 * k)
    for j in range(6):
        blip(t0 + 0.03 + j * 0.035, 2400 + 150 * j, 0.02, 0.14, pan=0.4)


CH.update({"Dm7": [D, F, A, C], "Gm7": [G, Bb, D, F]})
ROOT.update({"Dm7": 38})

# --- bar 0 (0-2): boot + logo build
blip(0.02, 1320, 0.06, 1.0)
blip(0.10, 1760, 0.08, 0.9)
kicks(0.0, (0,), 0.55)
arp = [65, 69, 72, 76, 72, 69, 77, 72]
for k in range(16):
    pluck(k * S16, arp[k % 8], 0.3, lvl=0.25 + 0.55 * k / 15, bright=800 + 5000 * k / 15,
          pan=(-0.35 if k % 2 else 0.35), rev=0.35)
supersaw(0.0, 2.0, voicing(CH["Fmaj7"]), lvl=0.75, a=0.6, d=1.0, s=0.9, r=0.3,
         cutoff_fn=lambda s: 350 + 2600 * (s / 2.0) ** 2, rev=0.5)
bell(0.38, 84, 1.4, 0.6, 0.2)
bell(0.52, 89, 1.2, 0.4, -0.3)
metal(0.3, 880, 1.2, 0.3, 0.4, rev=0.7)
riser(1.0, 1.0, 0.4, 55, 79)
reverse_cymbal(2.0, 0.8, 0.4)
whoosh(1.72, 0.3, 0.7, 300, 6000)

# --- bars 1-2 (2-6): school bento
for bar, ch in ((1, "Bbmaj7"), (2, "C")):
    b0 = bar * 2.0
    kicks(b0)
    clap(b0 + 0.5)
    clap(b0 + 1.5)
    if bar == 1:
        hats8off(b0, 0.6)
    else:
        hats16(b0, 0.65)
    for k in range(8):
        bass(b0 + k * 0.25 + 0.125, 0.11, ROOT[ch], 0.85)
    pad(b0, ch, lvl=0.3)
for k, t0 in enumerate([2.0, 2.5, 3.0, 3.5, 4.0]):
    pop(t0, "Bbmaj7" if t0 < 4 else "C", k)
riser(5.0, 1.0, 0.55, 55, 84)
tape_rip(5.84, 0.2, 0.6, 0.3)

# --- bar 3 (6-8): "오늘의 탐구가" breakdown
impact(6.0, 0.45, 48)
kicks(6.0, (0, 2), 0.8)
supersaw(6.0, 2.0, voicing(CH["Dm7"], 53), lvl=0.6, a=0.02, d=0.6, s=0.8, r=0.1,
         cutoff_fn=lambda s: 900 + 3500 * (s / 2.0), rev=0.5)
for k in range(16):
    pluck(6.0 + k * S16, [62, 65, 69, 72][k % 4] + (12 if k >= 8 else 0), 0.25, 0.15 + 0.35 * k / 15,
          1500 + 4000 * k / 15, pan=(-0.4 if k % 2 else 0.4), rev=0.35, delay=False)
bell(6.2, 86, 1.2, 0.35, 0.3)
clap(7.5, 0.8)
for k in range(8):
    snare(7.5 + k * S16 / 2, 0.2 + 0.08 * k, rev=0.1)
riser(7.0, 1.0, 0.6, 60, 90)
tape_rip(7.8, 0.22, 0.8, 0.2)

# --- bars 4-11 (8-24): booth cards, one per bar
BOOTH_CH = ["F", "C", "Dm", "Bb", "F", "C", "Dm", "Bb"]
LEAD = [[72, 77, 81, 79], [79, 76, 72, 74], [77, 74, 72, 69], [70, 74, 77, 81],
        [81, 84, 81, 79], [79, 76, 79, 84], [81, 77, 74, 77], [77, 81, 84, 86]]
for i, ch in enumerate(BOOTH_CH):
    b0 = 8.0 + i * 2.0
    kicks(b0)
    clap(b0 + 0.5)
    clap(b0 + 1.5)
    hats16(b0, 0.7 if i < 4 else 0.8)
    bassline(b0, ch)
    stab(b0, ch)
    whoosh(b0 - 0.13, 0.26, 0.5, 500, 8000, pan_from=0.8, pan_to=-0.8)
    hat(b0, 0.6, open_=True)
    for st, m in zip((4, 7, 10, 13), LEAD[i]):
        pluck(b0 + st * S16, m, 0.3, 0.28 if i < 4 else 0.36, 5000, pan=0.25, rev=0.35)
    if i >= 4:
        stab(b0 + 1.0, ch, 60, 0.5, 3500)
    pad(b0, ch, lvl=0.3)
# booth character SFX
for tk in np.sort(rng.uniform(8.1, 9.6, 40)):              # physics: geiger counter
    click(tk, rng.uniform(0.2, 0.5), 1500, 7000, 0.002, pan=rng.uniform(-0.6, 0.6))
whoosh(10.1, 0.6, 0.25, 180, 1200, up=False)                 # chemistry: pour
for tk in np.sort(rng.uniform(10.5, 11.8, 10)):              # chemistry: bubbles
    bloop(tk, rng.uniform(280, 650), 0.6, pan=rng.uniform(-0.5, 0.5))
for k, m in enumerate([84, 88, 91]):                          # life: focus pings
    blip(12.15 + k * 0.1, mtof(m), 0.05, 0.25, pan=0.2 * k)
whoosh(14.0, 1.2, 0.3, 150, 1400, pan_from=-0.9, pan_to=0.9)   # earth: wave swell
for k in range(20):                                           # maker: stepper whine
    blip(16.1 + k * 0.07, [520, 640, 590, 700, 560][k % 5], 0.06, 0.18, pan=0.3)
for tk in np.arange(18.1, 19.6, 0.05):                        # coding: typing
    click(tk + rng.uniform(0, 0.015), rng.uniform(0.2, 0.45), 2500, 5500, 0.004, pan=rng.uniform(-0.3, 0.3))
for k, m in enumerate([77, 81, 84, 88, 84, 89, 93, 89]):      # math: string-art plinks
    pluck(20.1 + k * 0.13, m, 0.25, 0.16, 7000, pan=(k % 3 - 1) * 0.6, rev=0.4, delay=False)

# --- bar 12 (24-26): grid of every booth
tape_rip(23.95, 0.2, 0.6, -0.3)
for k in range(8):
    blip(24.0 + k * S16 / 2, 1800 + 250 * k, 0.03, 0.18, pan=(-0.5 if k % 2 else 0.5))
kicks(24.0)
clap(24.5)
clap(25.5)
hats16(24.0, 0.7)
bassline(24.0, "Gm7")
pop(24.0, "Gm7", 0)
pop(24.5, "Gm7", 2)
pad(24.0, "Gm7", lvl=0.32)
whoosh(25.4, 0.6, 0.45, 300, 7000, up=False, pan_from=0.5, pan_to=-0.5)

# --- bar 13 (26-28): "내일의 가능성이 되는 곳" breakdown
impact(26.0, 0.5, 46)
kicks(26.0, (0, 2), 0.75)
supersaw(26.0, 2.0, voicing(CH["Bbmaj7"], 55), lvl=0.7, a=0.01, d=0.8, s=0.75, r=0.1,
         cutoff_fn=lambda s: 2500 * np.exp(-s / 1.2) + 1200, rev=0.6)
for t0, m in [(26.0, 81), (26.25, 84), (26.5, 86), (27.0, 89)]:
    bell(t0, m, 1.2, 0.4, 0.2 * (m % 3 - 1))
riser(27.0, 1.0, 0.6, 58, 89)
for k in range(8):
    snare(27.5 + k * S16 / 2, 0.2 + 0.09 * k, rev=0.1)
whoosh(27.82, 0.22, 0.5, 600, 9000)

# --- bars 14-15 (28-32): admissions results
for bar, ch in ((14, "F"), (15, "C")):
    b0 = bar * 2.0
    kicks(b0)
    clap(b0 + 0.5)
    clap(b0 + 1.5)
    hats16(b0, 0.75)
    bassline(b0, ch)
    pad(b0, ch, lvl=0.32)
for k, t0 in enumerate([28.0, 28.5, 29.0, 29.5]):
    pop(t0, "F", k)
for st, m in zip((0, 3, 6, 8, 11, 14), [84, 81, 84, 86, 84, 81]):
    pluck(30.0 + st * S16, m, 0.3, 0.3, 5000, pan=-0.2, rev=0.35)
for st, m in zip((0, 3, 6, 10), [79, 76, 79, 84]):
    pluck(31.0 + st * S16, m, 0.3, 0.3, 5000, pan=0.2, rev=0.35)
whoosh(31.86, 0.2, 0.55, 400, 8000)

# --- bar 16 (32-34): stamp rally
kicks(32.0, (0, 2), 0.85)
for k in range(16):
    if k % 2:
        hat(32.0 + k * S16, 0.4)
for i, m in enumerate([77, 79, 81, 84, 86]):
    t0 = 32.25 + i * 0.25
    thunk(t0, 0.95)
    bell(t0 + 0.01, m + 12, 0.8, 0.38, pan=-0.5 + 0.25 * i, rev=0.3)
for k, m in enumerate([77, 81, 84, 89]):
    pluck(33.5 + k * 0.06, m, 0.4, 0.45, 7000, pan=0.2, rev=0.4)
clap(33.5, 0.8)
metal(33.5, 610, 1.0, 0.55, 0.3)
bass(32.0, 0.9, ROOT["Gm7"], 0.9, cutoff=700)
bass(33.0, 0.9, ROOT["Gm7"], 0.9, cutoff=700)
supersaw(32.0, 2.0, voicing(CH["Gm7"], 53, top=False), lvl=0.4, cutoff=1700, a=0.05, s=0.9, rev=0.35)
for k in range(16):
    pluck(32.0 + k * S16, [67, 70, 74, 77][k % 4] + 12, 0.2, 0.1, 3000, pan=(-0.4 if k % 2 else 0.4),
          rev=0.3, delay=False)

# --- bar 17 (34-36): build — 제7회, roll, gap
impact(34.0, 0.55, 45)
metal(34.0, 330, 1.6, 0.9, -0.1)
kicks(34.0, (0, 1, 2, 3), 0.9)
roll = list(np.arange(34.0, 35.0, 0.25)) + list(np.arange(35.0, 35.5, S16)) + list(np.arange(35.5, 35.875, S16 / 2))
for t0 in roll:
    snare(t0, 0.25 + 0.75 * (t0 - 34.0) / 1.875, rev=0.15)
supersaw(34.0, 1.0, voicing(CH["Csus4"], 55), lvl=0.6, a=0.05, s=0.95, r=0.02,
         cutoff_fn=lambda s: 600 + 2500 * s, rev=0.3)
supersaw(35.0, 0.875, voicing(CH["C"], 55), lvl=0.75, a=0.02, s=0.95, r=0.01,
         cutoff_fn=lambda s: 3100 + 6000 * s / 0.875, rev=0.3)
for k in range(8):
    bass(34.0 + k * 0.25, 0.2, 36 + (12 if k % 2 else 0), 0.8, cutoff=500 + 150 * k)
for k in range(7):
    bass(35.0 + k * S16, 0.1, 48, 0.8, cutoff=1400 + 200 * k)
riser(34.0, 1.875, 0.9, 48, 91)
whoosh(35.0, 0.3, 0.5, 400, 9000, pan_from=0.8, pan_to=-0.8)
whoosh(35.55, 0.33, 0.65, 300, 12000)

# --- bars 18-19 (36-40): DROP — title, then date & route
impact(36.0, 1.0, 52)
metal(36.0, 500, 1.4, 0.55, 0.0)
fb_steps = [0, 3, 6, 10, 12, 14]
for half, ch in enumerate(["Fadd9", "Bbadd9", "Gm7", "C"]):
    b0 = 36.0 + half
    kicks(b0, (0, 1), 1.0)
    clap(b0 + 0.5)
    for k in range(8):
        hat(b0 + k * S16, HAT_ACC[k % 4] * 0.8, open_=(k % 4 == 2))
    for st in fb_steps:
        if st < 8:
            supersaw(b0 + st * S16, 0.16, voicing(CH[ch], 60), lvl=0.75, cutoff=6000, d=0.08, s=0.35, r=0.05)
    for st in range(8):
        bass(b0 + st * S16, 0.1, ROOT[ch] + (12 if st % 2 else 0), 0.9, cutoff=1300)
    pad(b0, ch, 1.0, lvl=0.25, cutoff=2000)
n_lead = int(0.75 * SR)
seg = np.arange(n_lead) / SR
f_lead = mtof(81 - 4 * np.clip((seg - 0.18) / 0.2, 0, 1))  # the "~" slide
for t0, m in [(36.0, 72), (36.125, 74), (36.25, 77)]:
    pluck(t0, m, 0.3, 0.7, 7000, rev=0.35)
pluck(36.375, 81, 0.75, 0.75, 7000, freq=f_lead, rev=0.35)
pluck(36.75, 84, 0.25, 0.9, 9000, rev=0.35)
bell(36.75, 96, 0.9, 0.45)
for t0, m in [(37.0, 81), (37.25, 79), (37.5, 77), (37.75, 72)]:
    pluck(t0, m, 0.3, 0.55, 6000, pan=0.15, rev=0.35)
tom(38.0, 0.6, 120)
whoosh(37.88, 0.2, 0.5, 400, 8000)
for t0, m in [(38.5, 79), (38.75, 82), (39.0, 84), (39.5, 86), (39.75, 88)]:
    pluck(t0, m, 0.3, 0.45, 6000, pan=-0.15, rev=0.35)
tape_rip(39.9, 0.2, 0.6, 0.0)

# --- bars 20-21 (40-44): end card + credit
impact(40.0, 0.8, 44)
kicks(40.0, (0,), 1.0)
supersaw(40.0, 3.0, voicing(CH["Fadd9"], 53), lvl=0.85, a=0.005, d=1.2, s=0.5, r=0.6,
         cutoff_fn=lambda s: 6000 * np.exp(-s / 1.2) + 500, rev=0.6)
bass(40.0, 2.6, 29, 1.0, cutoff=300)
bell(40.0, 89, 2.4, 0.55, 0.0, rev=0.7)
for k, m in enumerate([77, 81, 84, 88]):
    pluck(40.25 + k * 0.125, m, 0.4, 0.28, 5000, pan=(k % 2 - 0.5), rev=0.5)
bell(41.4, 96, 1.6, 0.35, 0.3, rev=0.7)   # credit chime
bell(41.52, 91, 1.6, 0.3, -0.3, rev=0.7)
supersaw(41.8, 2.2, voicing(CH["Bbadd9"], 53, top=False), lvl=0.3, a=0.4, s=0.9, r=0.5, cutoff=1500, rev=0.7)

# ---------------------------------------------------------------- mix
tl = np.arange(N + PAD) / SR
duck = np.ones(N + PAD)
for tk in kick_times:
    m = tl >= tk
    d = 1 - 0.72 * np.exp(-(tl[m] - tk) / 0.11)
    duck[m] = np.minimum(duck[m], d)
duck = filt(duck, "lowpass", 60, order=1)

# synthetic stereo plate-ish reverb
ir_t = np.arange(int(2.4 * SR)) / SR
irL = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.42)
irR = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.42)
irL = filt(irL, "lowpass", 6500)
irR = filt(irR, "lowpass", 6500)
irL[: int(0.012 * SR)] = 0
irR[: int(0.017 * SR)] = 0
irL /= np.sqrt(np.sum(irL ** 2))
irR /= np.sqrt(np.sum(irR ** 2))
vin_L = filt(verb.L, "highpass", 250)
vin_R = filt(verb.R, "highpass", 250)
wetL = signal.fftconvolve(vin_L, irL)[: N + PAD] * 0.9
wetR = signal.fftconvolve(vin_R, irR)[: N + PAD] * 0.9

L = drums.L * 0.95 + bass_bus.L * duck * 0.9 + synth.L * duck * 0.85 + fx.L * 0.8 + wetL * (0.6 + 0.4 * duck)
R = drums.R * 0.95 + bass_bus.R * duck * 0.9 + synth.R * duck * 0.85 + fx.R * 0.8 + wetR * (0.6 + 0.4 * duck)
L = filt(L, "highpass", 28)
R = filt(R, "highpass", 28)
L, R = L[:N], R[:N]
L, R = compress(L, R)

peak = max(np.abs(L).max(), np.abs(R).max())
g = 1.35 / peak
L = np.tanh(L * g) / np.tanh(1.35) * 0.93
R = np.tanh(R * g) / np.tanh(1.35) * 0.93
fade = np.ones(N)
nf = int(0.35 * SR)
fade[-nf:] = np.linspace(1, 0, nf) ** 1.5
fade[: int(0.004 * SR)] = np.linspace(0, 1, int(0.004 * SR))
L *= fade
R *= fade

pcm = (np.stack([L, R], 1) * 32767).astype(np.int16)
from scipy.io import wavfile  # noqa: E402

wavfile.write(os.path.join(OUT, "audio.wav"), SR, pcm)

# ---------------------------------------------------------------- features
mono = (L + R) / 2
win = 2048
hann = np.hanning(win)
freqs = np.fft.rfftfreq(win, 1 / SR)
edges = np.geomspace(40, 12000, 49)
frames = int(DUR * FPS)
rms_out, bands_out = [], []
for i in range(frames):
    c = int(i / FPS * SR)
    s = max(0, c - win // 2)
    seg = mono[s:s + win]
    if len(seg) < win:
        seg = np.pad(seg, (0, win - len(seg)))
    rms_out.append(float(np.sqrt(np.mean(seg ** 2))))
    mag = np.abs(np.fft.rfft(seg * hann))
    b = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (freqs >= lo) & (freqs < hi)
        v = mag[m].mean() if m.any() else 0
        b.append(v)
    bands_out.append(b)
bands = np.array(bands_out)
bands = 20 * np.log10(bands + 1e-6)
bands = np.clip((bands - (bands.max() - 60)) / 60, 0, 1)
rms = np.array(rms_out)
rms = rms / rms.max()
with open(os.path.join(OUT, "audio_features.json"), "w") as f:
    json.dump({"fps": FPS, "rms": [round(x, 3) for x in rms.tolist()],
               "bands": [[round(x, 3) for x in row] for row in bands.tolist()]}, f)
with open(os.path.join(OUT, "audio_features.json")) as f:
    feat = f.read()
with open(os.path.join(OUT, "audio_features.js"), "w") as f:
    f.write("window.AF=" + feat + ";\n")

print("peak", np.abs(pcm).max() / 32767, "rms dBFS", 20 * np.log10(np.sqrt(np.mean(mono ** 2))))
