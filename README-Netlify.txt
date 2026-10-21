2027 LINK PRAY ROOM — 배포 / 업데이트 안내
=========================================

배포 ZIP은 GitHub에 연결해 Netlify가 배포하는 프로젝트입니다. 정적 파일만 끌어다 놓는 방식은 Netlify Functions를 배포하지 못할 수 있습니다.

파일 구성
- public/index.html, public/app.js : 공개 사이트 화면과 동작
- netlify.toml : public 폴더 공개, Functions 위치 지정
- netlify/functions/ : Supabase 설정 반환 및 연락처 로그인 함수
- supabase-setup.sql : 최초 DB 설정
- supabase-update-prayer-responses.sql : 기존 DB에 기도응답 열 추가
- supabase-admin-prayer-update.sql : 기존 DB 관리자 RLS 수정, 공통 기도제목 기록/수정/삭제, 관리자 개인 기도제목 보기 추가

기존 GitHub 저장소에 업데이트할 때
압축을 풀고 ZIP 안의 모든 파일/폴더를 저장소 루트에 복사해 덮어쓴 뒤 commit/push 합니다. Netlify가 자동으로 새 배포를 시작합니다. Build command는 비워두고 netlify.toml이 적용되게 둡니다.

Supabase 최초 설정
1. 새 Supabase 프로젝트를 만듭니다.
2. SQL Editor에서 supabase-setup.sql을 한 번 실행합니다.
3. Netlify 배포 주소를 Supabase Authentication > URL Configuration의 Site URL과 Redirect URLs에 등록합니다.
4. Authentication > Sign In / Providers > Email에서 Email 가입과 이메일 확인을 켭니다.

기존 프로젝트에서 기도응답 기능만 적용
SQL Editor에서 supabase-update-prayer-responses.sql을 한 번 실행합니다. 최초 설치가 아니라면 supabase-setup.sql을 다시 실행하지 마세요.

기존 프로젝트에서 관리자 기능 업데이트
1. SQL Editor에서 최신 supabase-admin-prayer-update.sql 전체를 실행합니다. 이전 버전의 업데이트 SQL을 실행했더라도 다시 실행해 수정/삭제 권한을 반영하세요. 관리자 글쓰기 RLS 오류를 수정하고, 기존 공통 기도제목을 기록에 옮기며, 관리자 개인 기도제목 조회 권한을 추가합니다.
2. ZIP의 파일을 기존 GitHub 저장소 루트에 복사해 덮어쓰고 commit/push 합니다. Netlify 새 배포가 끝나면 관리자 계정에서 확인합니다.

Netlify 환경변수
Project configuration > Environment variables에서 아래 세 값을 등록하고 새 배포합니다. 함수가 읽을 수 있도록 Functions scope를 포함합니다.
SUPABASE_URL = Supabase Project URL
SUPABASE_ANON_KEY = Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY = Supabase service_role key (비밀키, 코드/GitHub에 절대 넣지 않기)

관리자 계정 설정
1. 일반 회원가입으로 별도 관리자 이메일 계정을 만들고 이메일 인증을 끝냅니다.
2. Supabase Dashboard > Authentication > Users에서 그 사용자의 UUID를 복사합니다.
3. SQL Editor에서 UUID를 실제 값으로 바꿔 아래 문장을 실행합니다.
   update public.profiles set role='admin' where id='사용자-UUID';
4. 해당 계정에서 로그아웃 후 다시 로그인합니다. 상단 관리자 메뉴에서 관리자 화면으로 들어갑니다.

기능 메모
- 마이페이지 진입 시 로그인 이메일과 비밀번호를 다시 확인합니다.
- 이메일 인증메일을 보낸 뒤 링크를 확인하고 회원가입 버튼을 누릅니다.
- 회원 연락처는 DB에 숫자만 저장하고 입력 화면에는 010-0000-0000 형식으로 보여줍니다.
- 기도 시작 시 서버에 시작시각을 저장하고, 기도 마치기 시 경과초를 저장합니다. 새로고침한 경우 활성 기도 기록을 이어서 마칠 수 있습니다.
- 기도 응답 기능을 위해 personal_prayer_topics에 response_content / responded_at 열이 추가됩니다.
- 공통 기도제목은 게시 날짜와 함께 기도실에 표시되고, 관리자 화면에서 누적 기록을 수정하거나 삭제할 수 있습니다.
- 로그인한 사용자가 기도실에 들어오면 Supabase Realtime Presence로 이름을 즉시 공유하며, 화면이 열려 있는 동안 기도 중 상태도 5초 간격으로 갱신합니다.
- 개인 프로필, 기도기록, 기도제목은 RLS로 본인만 조회할 수 있고, 관리자 계정은 개인 기도제목과 이름/그룹 정보를 관리자 화면에서 확인할 수 있습니다. 현재 기도 중인 이름과 전체 누적 시간은 공개됩니다.
- 관리자 음원은 40MB 이하 파일을 올리고, 사용 허가를 받은 음원만 이용하세요.
