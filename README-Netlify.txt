2027 LINK PRAY ROOM — Netlify 배포 안내
=======================================

파일 구성
- index.html : Netlify 시작 페이지 (단독 HTML 파일은 link-pray-room.html)
- netlify.toml 및 netlify/functions/ : Netlify 설정, 공개 설정 반환 및 연락처 로그인 함수
- supabase-setup.sql : 계정/기도기록/권한/음원 저장소 준비 SQL

중요: 정적 HTML 파일 하나만 올리면 공유 로그인과 DB는 동작하지 않습니다. 아래 단계를 한 번 설정해야 실제 서비스가 됩니다.

1. 이 outputs 폴더의 파일과 netlify 폴더를 통째로 GitHub 저장소에 올립니다.
   index.html이 배포 시작 페이지입니다.
   (또는 Netlify publish directory에서 파일을 index.html로 제공하는 별도 폴더를 지정합니다.)
2. Netlify에서 저장소를 Import 해 배포합니다. 빌드 명령은 비워두고 publish directory는 저장소 루트로 둡니다.
3. Supabase 프로젝트를 만들고 SQL Editor에서 supabase-setup.sql 전체를 실행합니다.
4. Supabase > Authentication > URL Configuration에서 Site URL과 Redirect URL에 배포된 Netlify 주소를 등록합니다.
   Authentication > Providers에서 Email을 활성화하고 이메일 확인을 켭니다.
5. Netlify > Site configuration > Environment variables에 다음 값을 설정하고 재배포합니다.
   SUPABASE_URL = Supabase Project URL
   SUPABASE_ANON_KEY = Supabase anon/public key
   SUPABASE_SERVICE_ROLE_KEY = Supabase service_role key (절대 HTML/GitHub에 넣지 마세요)
6. Supabase URL과 anon 공개 키는 Netlify config 함수가 환경변수에서 읽으므로 HTML 수정은 필요 없습니다. RLS가 DB 접근을 제한합니다.
7. 회원가입은 이메일+비밀번호를 인증 기준으로 만들고 연락처를 함께 저장합니다. 로그인은 이메일 직접 인증 또는 연락처를 Netlify 함수가 계정 이메일로 찾아 인증합니다.
   가입 후 이메일 인증이 필요합니다. 연락처 로그인은 같은 연락처가 중복되지 않도록 DB unique constraint로 처리됩니다.
8. 관리자 지정은 Supabase Dashboard > Authentication > Users에서 관리자로 지정할 사용자 UUID를 확인한 뒤 SQL Editor에서 실행합니다.
   update public.profiles set role='admin' where id='사용자-UUID';
   이후 Supabase Dashboard > Authentication > Users > 해당 사용자 > app_metadata에 아래 JSON을 설정하고 저장합니다.
   { "role": "admin" }
   로그아웃 후 다시 로그인하면 관리자 메뉴가 표시됩니다. 관리자 권한은 app_metadata JWT claim에 의해 DB에서도 검사됩니다.

보안/운영 메모
- 비밀번호는 Supabase Auth가 관리합니다. 이 앱은 비밀번호를 프로필 테이블에 기록하지 않습니다.
- 프로필과 개인 기도제목은 RLS로 본인만 읽게 구성했고, 개인 기도시간도 본인만 조회할 수 있습니다. 전체 합계만 공개 RPC로 제공합니다.
- 현재 활성 기도자의 표시 이름은 기도실 참여자 모두에게 보입니다. 연락처, 이메일, 기수 등은 공개하지 않습니다.
- 연락처는 로그인 ID 검색에 사용되므로 번호 인증을 추가하는 것을 권장합니다. 이 패키지는 SMS 인증을 포함하지 않습니다.
- Netlify 함수의 전화번호 조회는 인증된 비밀번호 검증 전에는 계정 이메일을 반환하지 않습니다. 공개 운영 전 CAPTCHA/요청 제한을 추가하고, 연락처 수집 고지/보관 기준을 정하세요.
- 관리자 음원 업로드는 40MB 제한입니다. 사용 허가를 확인한 음원만 올리고, 이용자 기기에서 각자 재생 버튼을 눌러 재생합니다.
- 업로드 파일은 Netlify CLI 또는 Git 연동 배포의 배포 루트에 포함되어야 Netlify Functions가 배포됩니다.

Supabase 프로젝트 연결 정보와 Netlify 함수 환경변수를 설정하기 전에는 로그인/DB 연동이 작동하지 않습니다.




