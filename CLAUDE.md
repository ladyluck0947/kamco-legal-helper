# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## 프로젝트 개요

"캠코 법률 도우미": 캠코 직원(특히 국유재산 업무를 처음 맡은 직원)이 국유재산 관련 법률 질문을 하면, 공개된 법령·판례·행정심판 재결례·행정소송 사건·유권해석을 근거로 답하는 챗봇이다. 기획의 기준 문서는 `PRD.md`이며, 기능·규칙·범위를 바꿀 때는 PRD.md와 어긋나지 않는지 먼저 확인한다. 구현은 PRD.md 맨 아래 "개발 단위" 표의 순서대로 한 단위씩 진행한다.

작성자(사용자)는 개발 초보다. 설명은 초보자 눈높이에 맞춰 한다.

## 작업 규칙

- 모든 설명과 주석은 한국어로 작성한다.
- 새 파일은 my-app 폴더 안에만 만든다.
- 코드를 바꾸면 무엇을 왜 바꿨는지 반드시 한 줄로 알려 준다.
- 파일을 지워야 할 때는 바로 삭제하지 않는다. my-app 안에 `trash-can` 폴더를 만들어 그 안으로 옮겨만 두고, 실제 삭제는 사용자가 직접 확인한 뒤 한다.
- 이미 설치된 서브에이전트(bkit 에이전트 등)는 필요할 때마다 적극 활용한다.
- 외부 서비스 인증이 필요하면 토큰 값을 사용자에게 묻거나 채팅에 출력하지 않고, `.env`에 있는 값을 읽어 사용한다.
  - Supabase 작업이 필요하면 Supabase CLI를 설치해 `.env`의 `SUPABASE_ACCESS_TOKEN`으로 작업한다.
  - Vercel 작업(배포 등)이 필요하면 Vercel CLI를 설치해 `.env`의 `VERCEL_TOKEN`으로 인증해 작업한다.
- `.env` 등 비밀 정보 파일과 `node_modules` 폴더는 `.gitignore`에 등록해 두고 절대 커밋하지 않는다.
- 커밋하기 전에 `git status`로 `.env` 같은 비밀 값 파일이 커밋 대상에 들어가지 않았는지 확인한다.
- 커밋 메시지는 한국어로, 무엇을 왜 바꿨는지 한 줄로 적는다.

## 명령어

```bash
npm run dev     # 개발 서버 (http://localhost:3000)
npm run build   # 프로덕션 빌드
npm run start   # 빌드 결과 실행
npm run lint    # ESLint 검사
```

테스트 도구는 아직 설정되어 있지 않다.

## 구조와 설정

- Next.js 16 App Router, `src/` 폴더 없이 `app/`이 프로젝트 최상위에 있다. 경로 별칭 `@/*`는 프로젝트 최상위(`./*`)를 가리킨다.
- `next.config.ts`에서 `cacheComponents`와 `partialPrefetching`이 켜져 있다. 데이터 가져오기·캐싱 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 확인한다.
- Tailwind CSS v4는 `app/globals.css`의 `@import "tailwindcss"`와 `next.config.ts`의 Turbopack 로더(`@tailwindcss/turbopack`)로 연결된다. 별도의 `tailwind.config` 파일은 없다.
- `LayoutProps<"/">` 같은 라우트 타입은 Next.js가 자동 생성한다(`next-env.d.ts`, `.next/`).

## 반드시 지킬 제약 (PRD.md 기준)

- 기술 스택은 PRD에 정한 대로 Next.js로 고정이다. 화면과 서버 쪽 코드(API Route)를 이 프로젝트 안에서 모두 처리하고, 다른 프레임워크로 바꾸거나 마이그레이션·별도 백엔드를 제안하지 않는다. 배포는 Vercel을 사용한다.
- AI 서비스 API 키 등 비밀 값은 `.env`에만 두고 서버 쪽 코드에서만 읽는다. 클라이언트 컴포넌트나 `NEXT_PUBLIC_` 변수로 노출하지 않는다. `.env`에는 `GITHUB_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN`, `OPENAI_API_KEY`가 있으며, 값을 출력하거나 읽어서 보여 주지 않는다.
- 질문과 답변은 서버나 DB에 저장하지 않는다. 대화 맥락은 브라우저 화면이 열려 있는 동안에만 유지한다.
- 숫자 형태의 개인정보(주민등록번호·전화번호·계좌번호)가 든 질문은 AI로 보내기 전에 막고, 입력 내용은 유지한 채 문제 부분만 표시한다.
- 참고 자료는 공개 자료만 쓴다. 자주 쓰는 자료는 프로젝트에 미리 넣어 두고, 없는 내용은 국가법령정보센터 공개 자료를 조회해 보완한다. 캠코 내부 자료는 외부 반출이 불가능하므로 다루지 않는다.
- 로그인·회원 관리, 모바일 앱, 국유재산 외 업무, nice 기능(기록 저장·FAQ·개정 알림)은 이번 범위가 아니다.
- AI 답변 규칙(3문장 요약, 법령 시행일 표시, 사건번호를 지어내지 않기, 사례 최대 3건 등)은 PRD.md 5번 "주요 기능"에 있다. 프롬프트를 작성할 때 그대로 반영한다.

## 기타

- `.bkit/`은 bkit 플러그인이 만드는 실행 기록 폴더이며 `.gitignore`에 들어 있다.
