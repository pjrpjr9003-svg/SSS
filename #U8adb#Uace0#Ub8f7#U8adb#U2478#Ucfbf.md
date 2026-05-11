# 도시대기측정소 점검앱 – PWA 배포 방법

## 📦 포함 파일
| 파일 | 설명 |
|------|------|
| index.html | 앱 본체 (기존 HTML + PWA 기능 추가) |
| manifest.json | 앱 이름·아이콘·테마 설정 |
| sw.js | 오프라인 캐싱용 서비스 워커 |
| icon-192.png | 홈화면 아이콘 (192×192) |
| icon-512.png | 스플래시/스토어용 아이콘 (512×512) |

---

## 🚀 무료 배포 방법 3가지

### ① GitHub Pages (추천 – 무료, 영구)

1. [github.com](https://github.com) 에서 계정 만들기
2. 새 저장소(Repository) 생성 → **Public** 선택
3. 이 폴더 안의 파일을 모두 업로드
4. Settings → Pages → Branch: `main` → Save
5. `https://사용자명.github.io/저장소명/` 으로 접속 완료

### ② Netlify (드래그앤드롭 배포)

1. [netlify.com](https://netlify.com) 접속 → 무료 계정 생성
2. **"Add new site" → "Deploy manually"** 클릭
3. 이 폴더 전체를 드래그앤드롭
4. 30초 안에 배포 완료 → 자동으로 주소 생성

### ③ 내부망 PC/서버 (인터넷 불필요)

로컬에서 테스트하려면:
```bash
# Python이 있다면
python3 -m http.server 8080

# Node.js가 있다면
npx serve .
```
→ `http://localhost:8080` 접속

> ⚠️ 파일을 더블클릭으로 열면 PWA가 동작하지 않습니다.
> 반드시 웹서버를 통해 열어야 합니다.

---

## 📱 홈화면에 설치하는 방법

### Android (Chrome)
- 배포 주소 접속 후 **"홈화면에 추가"** 배너 → **설치** 버튼 클릭

### iPhone (Safari)
1. Safari로 접속
2. 하단 **공유 버튼** (□↑) 탭
3. **"홈 화면에 추가"** 선택
4. 이름 확인 후 **추가** 탭

---

## 💾 데이터 저장 방식
- 점검 데이터는 **기기 localStorage에 자동 저장**됩니다
- 앱을 닫거나 재시작해도 데이터가 유지됩니다
- 브라우저 데이터 삭제 시 함께 삭제될 수 있으니 PDF/엑셀로 백업 권장

---

## 🔌 오프라인 지원
- 한 번 접속한 후에는 **인터넷 없이도** 사용 가능합니다
- PDF/엑셀 저장 기능도 오프라인에서 동작합니다
