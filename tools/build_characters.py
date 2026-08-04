"""캐릭터 에셋 빌드: images/ 의 원본 -> public/characters/ 의 투명 PNG + 메타데이터.

    python3 tools/build_characters.py

원본을 새로 받으면(예: 입 다문 버전) images/ 를 갈아끼우고 이걸 다시 돌린 뒤,
출력된 메타데이터를 src/minigames/cast.ts 의 META 에 붙여넣으면 된다.
필요한 것: pillow, numpy, scipy

1) 흰 배경 제거 (가장자리 flood fill — 눈·리본 등 내부 흰색은 보존)
2) 본체만 남기기 (girl3 의 스크린샷 UI, man1·man3 의 잔선 제거)
3) 크기 통일 (전신 5명은 키 기준, 다리가 잘린 girl1 만 머리 폭 기준)
4) 입 앵커를 정규화 좌표로 변환해 TS 로 출력
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'images')            # 손 안 댄 원본
DST = os.path.join(ROOT, 'public', 'characters')  # 게임이 쓰는 결과물
os.makedirs(DST, exist_ok=True)

WHITE = 235
TARGET_H = 220
CROPPED = {'girl1'}          # 다리가 잘려 있어 키로 정규화할 수 없다
# 입 중심(원본 crop 후 좌표). 눈으로 맞춘 값.
MOUTH = {
    'girl1': (71, 76), 'girl2': (72, 94), 'girl3': (76, 100),
    'man1': (78, 84), 'man2': (63, 100), 'man3': (68, 100),
}
NAMES = ['man1', 'man2', 'man3', 'girl1', 'girl2', 'girl3']


def cutout(name):
    im = Image.open(f'{SRC}/{name}.png').convert('RGBA')
    a = np.array(im)
    whiteish = a[:, :, :3].min(axis=2) >= WHITE

    lbl, _ = ndimage.label(whiteish)
    edge = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    edge.discard(0)
    solid = ~np.isin(lbl, list(edge))

    lbl2, n2 = ndimage.label(solid)
    sizes = ndimage.sum(solid, lbl2, range(1, n2 + 1))
    body = lbl2 == int(np.argmax(sizes)) + 1

    out = a.copy()
    out[:, :, 3] = np.where(body, 255, 0)
    img = Image.fromarray(out)
    box = img.getbbox()
    return img.crop(box), box


def head_width(im):
    a = np.array(im)[:, :, 3] > 40
    top = a[: int(a.shape[0] * 0.55)]
    return float(max((np.nonzero(r)[0][-1] - np.nonzero(r)[0][0] + 1) if r.any() else 0
                     for r in top))


cuts = {n: cutout(n) for n in NAMES}
scale = {n: TARGET_H / im.height for n, (im, _) in cuts.items() if n not in CROPPED}
ref_head = head_width(cuts['girl2'][0]) * scale['girl2']
for n in CROPPED:
    scale[n] = ref_head / head_width(cuts[n][0])

rows = []
for n in NAMES:
    im, box = cuts[n]
    s = scale[n]
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    im.resize((w, h), Image.LANCZOS).save(f'{DST}/{n}.png')
    mx, my = MOUTH[n]                      # cut 좌표 (이미 bbox crop 기준)
    rows.append((n, w, h, round(mx * s, 1), round(my * s, 1)))
    print(f'{n:6} {str(im.size):11} x{s:5.3f} -> {w:3}x{h:3}  입({mx*s:5.1f},{my*s:5.1f})')

print('\n// --- character.ts 에 넣을 메타데이터 ---')
for n, w, h, mx, my in rows:
    print(f"  {n}: {{ w: {w}, h: {h}, mouth: {{ x: {mx}, y: {my} }} }},")
