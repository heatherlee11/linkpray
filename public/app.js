import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmt = (seconds) => [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)]
  .map((part) => String(part).padStart(2, '0')).join(':');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const phoneFormat = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};
const phoneDigits = (value) => String(value || '').replace(/\D/g, '');

let supabase = null;
let configured = false;
let user = null;
let profile = null;
let activeSessionId = null;
let activeStartedAt = 0;
let completedPrayerSeconds = 0;
let prayerTicker = null;
let adminLoginPending = false;
let initialized = false;
let roomPollerStarted = false;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 3000);
}

function page(id) {
  $$('.page').forEach((section) => section.classList.toggle('active', section.id === id));
  $$('.nav [data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === id));
  window.scrollTo(0, 0);
  if (id === 'mypage') loadMine();
}

function authTab(tab) {
  $$('[data-auth-tab]').forEach((button) => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#loginForm').classList.toggle('active', tab === 'login');
  $('#signupForm').classList.toggle('active', tab === 'signup');
  if (tab === 'signup') refreshSignupGate();
}

window.openAuth = (tab = 'login') => {
  if (!configured) return toast('Supabase 연결 설정 후 로그인을 사용할 수 있어요.');
  $('#authModal').classList.add('open');
  authTab(tab);
};

function refreshSignupGate() {
  const email = $('#signupForm [name="email"]').value.trim().toLowerCase();
  const verified = !!(user && user.email_confirmed_at && user.email?.toLowerCase() === email);
  $('#completeSignup').disabled = !verified;
  $('#signupForm [name="password"]').required = !verified;
  $('#emailVerifyStatus').textContent = verified
    ? '이메일 인증이 확인됐어요. 회원가입을 완료해 주세요.'
    : (localStorage.getItem('linkpray-pending-email') === email && email
      ? '인증메일의 링크를 눌러 인증을 마친 뒤 이 화면으로 돌아오세요.'
      : '이메일 인증을 먼저 진행해 주세요.');
}

function showProfile() {
  $('#signedOut').classList.toggle('hidden', !!user);
  $('#myContent').classList.toggle('hidden', !user);
  if (!user) return;
  $('#myName').textContent = profile?.name || '기도자';
  $('#profileName').value = profile?.name || '';
  $('#profilePhone').value = phoneFormat(profile?.phone || '');
  $('#profileCohort').value = profile?.cohort || '';
  $('#profileGroup').value = profile?.group_name || '';
  $('#profileDarabang').value = profile?.darabang || '';
  $('#profileSoon').value = profile?.soon || '';
  $('#profileEmailInput').value = user.email || '';
  updateEmailChangeState();
  $('#myProfileDetails').textContent = [profile?.cohort && `${profile.cohort}기`, profile?.group_name,
    profile?.darabang, profile?.soon && `${profile.soon}순`].filter(Boolean).join(' · ');
}

function updateEmailChangeState() {
  if (!user) return;
  const pending = localStorage.getItem('linkpray-pending-email-change')?.trim().toLowerCase();
  const applied = !!(pending && user.email_confirmed_at && user.email?.toLowerCase() === pending);
  $('#emailReauthBox').classList.toggle('hidden', !applied);
  $('#emailChangeStatus').textContent = applied
    ? '새 이메일 인증이 확인됐어요. 비밀번호를 다시 입력해 변경을 확정해 주세요.'
    : (pending
      ? `Supabase 이메일 변경 설정에 따라 새 주소와 기존 주소에서 인증을 완료한 뒤 이 화면으로 돌아오세요. (요청: ${pending})`
      : '이메일을 변경하려면 새 주소로 인증을 완료해 주세요.');
  $('#confirmEmailChange').disabled = !applied;
}

async function requestEmailChange() {
  const email = $('#profileEmailInput').value.trim().toLowerCase();
  if (!email || !$('#profileEmailInput').checkValidity()) return toast('올바른 이메일 주소를 입력해 주세요.');
  if (email === user.email?.toLowerCase()) return toast('현재 이메일과 다른 주소를 입력해 주세요.');
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
  );
  if (error) return toast(error.message);
  localStorage.setItem('linkpray-pending-email-change', email);
  updateEmailChangeState();
  toast('인증메일을 보냈어요. 메일 안내에 따라 인증을 완료해 주세요.');
}

async function confirmEmailChange() {
  const email = localStorage.getItem('linkpray-pending-email-change')?.trim().toLowerCase();
  const password = $('#emailReauthPassword').value;
  if (!email || !password) return toast('계정 비밀번호를 입력해 주세요.');
  if (!user.email_confirmed_at || user.email?.toLowerCase() !== email) return toast('새 이메일 인증이 아직 완료되지 않았어요.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return toast('비밀번호를 확인해 주세요.');
  user = data.user;
  localStorage.removeItem('linkpray-pending-email-change');
  $('#emailReauthPassword').value = '';
  await init();
  toast('이메일 변경을 확정했어요.');
}

async function init() {
  if (!configured) return;
  const { data: { session } } = await supabase.auth.getSession();
  user = session?.user || null;
  profile = null;
  if (user) {
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    profile = data || {};
    const pendingEmail = localStorage.getItem('linkpray-pending-email');
    if (pendingEmail && pendingEmail.toLowerCase() === user.email?.toLowerCase()) {
      const signup = $('#signupForm');
      signup.elements.email.value = user.email;
      signup.elements.phone.value = phoneFormat(profile.phone || '');
      signup.elements.name.value = profile.name || '';
      signup.elements.cohort.value = profile.cohort || '';
      signup.elements.group_name.value = profile.group_name || '';
      signup.elements.darabang.value = profile.darabang || '';
      signup.elements.soon.value = profile.soon || '';
      $('#emailVerifyStatus').textContent = '이메일 인증이 확인됐어요. 회원가입을 완료해 주세요.';
    }
  }
  $('#authButton').classList.toggle('hidden', !!user);
  $('#logoutButton').classList.toggle('hidden', !user);
  $('#adminNav').classList.remove('hidden');
  $('#homeMyStat').classList.toggle('hidden', !user);
  showProfile();
  refreshSignupGate();
  await loadRoom();
  if (user) {
    await loadMine();
    await restoreActivePrayer();
  }
  if (adminLoginPending && user) {
    adminLoginPending = false;
    if (profile?.role === 'admin') page('admin');
    else toast('이 계정은 관리자 권한이 없어요.');
  }
  initialized = true;
}

async function restoreActivePrayer() {
  const { data: active } = await supabase.from('active_prayers').select('session_id,started_at').eq('user_id', user.id).maybeSingle();
  if (!active) return;
  activeSessionId = active.session_id;
  activeStartedAt = Date.parse(active.started_at);
  $('#startBtn').classList.add('hidden');
  $('#stopBtn').classList.remove('hidden');
  $('#timerHint').textContent = '기도 중 · 기도 마치기를 누르면 시간이 저장됩니다';
  startTicker();
}

async function loadRoom() {
  if (!configured) return;
  const { data: settings } = await supabase.from('room_settings').select('*').eq('id', 1).maybeSingle();
  if (settings) {
    $('#roomTopic').textContent = settings.prayer_topic || '주님, 이 공간을 찾는 모든 이에게 평안과 소망을 주세요.';
    $('#topicBy').textContent = settings.prayer_topic ? '관리자가 나눈 오늘의 기도제목' : '기도제목을 마음에 담고 잠시 머물러 보세요.';
    if (settings.audio_url) {
      $('#audio').src = settings.audio_url;
      $('#musicName').textContent = settings.audio_name || '배경음악';
    }
  }
  await refreshPresence();
  await refreshTotal();
  if (window.prayerRoomChannel) await supabase.removeChannel(window.prayerRoomChannel);
  window.prayerRoomChannel = supabase.channel('prayer-room')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'active_prayers' }, refreshPresence)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_settings' }, loadRoom)
    .subscribe();
  if (!roomPollerStarted) {
    roomPollerStarted = true;
    setInterval(refreshPresence, 30000);
    setInterval(refreshTotal, 30000);
  }
}

async function refreshPresence() {
  const { data, error } = await supabase.from('active_prayers').select('user_id,display_name,started_at');
  if (error) return;
  const people = data || [];
  $('#homeCount').textContent = people.length;
  $('#countLabel').textContent = `${people.length}명`;
  $('#people').innerHTML = people.length
    ? people.map((person) => `<div class="person"><span class="dot"></span>${esc(person.display_name)}<span class="pill">기도 중</span></div>`).join('')
    : '<div class="empty">아직 기도 중인 사람이 없어요.<br>첫 번째로 기도를 시작해 보세요.</div>';
}

async function refreshTotal() {
  const { data, error } = await supabase.rpc('public_prayer_total_seconds');
  if (!error) $('#homeTotal').textContent = fmt(Number(data || 0));
}

async function loadMine() {
  if (!user || !configured) return;
  const { data: sessions, error } = await supabase.from('prayer_sessions')
    .select('id,started_at,ended_at,duration_seconds').eq('user_id', user.id).order('started_at', { ascending: false });
  if (error) return;
  completedPrayerSeconds = (sessions || []).reduce((sum, session) => sum + Number(session.duration_seconds || 0), 0);
  const liveSeconds = activeSessionId ? Math.floor((Date.now() - activeStartedAt) / 1000) : 0;
  $('#myTotal').textContent = fmt(completedPrayerSeconds + liveSeconds);
  $('#homeMyTotal').textContent = fmt(completedPrayerSeconds + liveSeconds);
  const { data: topics } = await supabase.from('personal_prayer_topics').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  $('#myTopics').innerHTML = (topics || []).length ? topics.map(renderPrayerTopic).join('')
    : '<div class="empty">저장된 기도제목이 없습니다.</div>';
}

function renderPrayerTopic(topic) {
  const created = new Date(topic.created_at).toLocaleDateString('ko-KR');
  const response = topic.responded_at
    ? `<div class="answer-box"><strong>${new Date(topic.responded_at).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '')} 기도응답</strong><div>${esc(topic.response_content)}</div></div>`
    : '';
  return `<article class="topic"><small>${created}</small><div>${esc(topic.content)}</div>${response}
    <div class="topic-actions"><button class="response-button" type="button" onclick="window.toggleTopicEdit('${topic.id}')">수정</button>
    <button class="response-button" type="button" onclick="window.deletePrayerTopic('${topic.id}')">삭제</button>
    <button class="response-button" type="button" onclick="window.toggleResponse('${topic.id}')">${topic.response_content ? '응답 수정' : '응답 기록'}</button></div>
    <div class="response-editor hidden" id="topic-editor-${topic.id}"><textarea class="field" id="topic-text-${topic.id}">${esc(topic.content)}</textarea><button class="secondary" type="button" onclick="window.savePrayerTopic('${topic.id}')">수정 저장</button></div>
    <div class="response-editor hidden" id="response-editor-${topic.id}"><textarea class="field" id="response-text-${topic.id}" placeholder="기도 응답 내용을 적어주세요.">${esc(topic.response_content || '')}</textarea><button class="secondary" type="button" onclick="window.savePrayerResponse('${topic.id}')">응답 저장</button></div></article>`;
}

window.toggleTopicEdit = (id) => $(`#topic-editor-${id}`).classList.toggle('hidden');
window.savePrayerTopic = async (id) => {
  const content = $(`#topic-text-${id}`).value.trim();
  if (!content) return toast('기도제목을 입력해 주세요.');
  const { error } = await supabase.from('personal_prayer_topics').update({ content }).eq('id', id).eq('user_id', user.id);
  if (error) return toast(error.message);
  await loadMine();
  toast('기도제목을 수정했어요.');
};
window.deletePrayerTopic = async (id) => {
  if (!window.confirm('이 기도제목을 삭제할까요?')) return;
  const { error } = await supabase.from('personal_prayer_topics').delete().eq('id', id).eq('user_id', user.id);
  if (error) return toast(error.message);
  await loadMine();
  toast('기도제목을 삭제했어요.');
};
window.toggleResponse = (id) => $(`#response-editor-${id}`).classList.toggle('hidden');
window.savePrayerResponse = async (id) => {
  const content = $(`#response-text-${id}`).value.trim();
  if (!content) return toast('기도 응답 내용을 입력해 주세요.');
  const { error } = await supabase.from('personal_prayer_topics').update({ response_content: content, responded_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id);
  if (error) return toast(error.message);
  await loadMine();
  toast('기도 응답을 기록했어요.');
};

function startTicker() {
  clearInterval(prayerTicker);
  const update = () => {
    if (!activeSessionId) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000));
    $('#timer').textContent = fmt(elapsed);
    $('#myTotal').textContent = fmt(completedPrayerSeconds + elapsed);
    $('#homeMyTotal').textContent = fmt(completedPrayerSeconds + elapsed);
  };
  update();
  prayerTicker = setInterval(update, 1000);
}

async function beginPrayer() {
  if (!user) return window.openAuth('login');
  if (activeSessionId) return;
  const clickedAt = Date.now();
  const startedAt = new Date(clickedAt).toISOString();
  const { data: session, error } = await supabase.from('prayer_sessions')
    .insert({ user_id: user.id, started_at: startedAt }).select('id,started_at').single();
  if (error) return toast(error.message);
  const { error: presenceError } = await supabase.from('active_prayers').upsert({
    user_id: user.id, display_name: profile?.name || user.user_metadata?.name || '기도자',
    session_id: session.id, started_at: session.started_at
  });
  if (presenceError) {
    await supabase.from('prayer_sessions').delete().eq('id', session.id);
    return toast(presenceError.message);
  }
  activeSessionId = session.id;
  activeStartedAt = Date.parse(session.started_at);
  if (!Number.isFinite(activeStartedAt)) activeStartedAt = clickedAt;
  $('#startBtn').classList.add('hidden');
  $('#stopBtn').classList.remove('hidden');
  $('#timerHint').textContent = '기도 중 · 기도 마치기를 누르면 시간이 저장됩니다';
  // Start the visible clock before waiting for the browser's audio permission.
  startTicker();
  try {
    await $('#audio').play();
    $('#musicHint').textContent = '기도 중 배경음악 재생';
  } catch {
    $('#musicHint').textContent = '브라우저가 자동재생을 막았어요. 음악 재생 버튼을 눌러주세요.';
  }
  await refreshPresence();
  toast('기도시간 기록을 시작했어요.');
}

async function stopPrayer() {
  if (!activeSessionId) return;
  clearInterval(prayerTicker);
  const id = activeSessionId;
  const seconds = Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000));
  const { error } = await supabase.from('prayer_sessions').update({
    ended_at: new Date().toISOString(), duration_seconds: seconds
  }).eq('id', id).eq('user_id', user.id);
  const { error: presenceError } = await supabase.from('active_prayers').delete().eq('user_id', user.id);
  activeSessionId = null;
  activeStartedAt = 0;
  $('#audio').pause();
  $('#timer').textContent = '00:00:00';
  $('#timerHint').textContent = '로그인 후 기도를 시작할 수 있어요';
  $('#musicHint').textContent = '재생 버튼을 눌러 음악을 들어보세요';
  $('#startBtn').classList.remove('hidden');
  $('#stopBtn').classList.add('hidden');
  await refreshPresence();
  await refreshTotal();
  await loadMine();
  if (error || presenceError) toast((error || presenceError).message);
  else toast('시작부터 마칠 때까지의 기도시간을 저장했어요.');
}

async function sendVerificationEmail() {
  const form = $('#signupForm');
  const emailInput = form.elements.email;
  emailInput.value = emailInput.value.trim().toLowerCase();
  if (!form.checkValidity()) return form.reportValidity();
  if (user && user.email?.toLowerCase() === emailInput.value && user.email_confirmed_at) {
    return toast('이미 이 이메일을 인증했어요. 회원가입을 눌러주세요.');
  }
  const values = Object.fromEntries(new FormData(form).entries());
  values.phone = phoneDigits(values.phone);
  if (values.phone.length !== 11 || !values.phone.startsWith('010')) return toast('휴대폰 번호를 010-0000-0000 형식으로 입력해 주세요.');
  $('#verifyEmailBtn').disabled = true;
  try {
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: {
        name: values.name.trim(), phone: values.phone, cohort: values.cohort.trim(),
        group_name: values.group_name.trim(), darabang: values.darabang.trim(), soon: values.soon.trim()
      } }
    });
    if (error) throw error;
    localStorage.setItem('linkpray-pending-email', values.email);
    if (data.session?.user?.email_confirmed_at) {
      user = data.session.user;
      refreshSignupGate();
      return toast('이메일이 확인됐어요. 회원가입을 눌러주세요.');
    }
    $('#emailVerifyStatus').textContent = '인증메일을 보냈어요. 메일의 인증 링크를 누른 뒤 이 사이트로 돌아오세요.';
    toast('인증메일을 보냈어요.');
  } catch (error) {
    toast(error.message || '인증메일을 보내지 못했어요.');
  } finally {
    $('#verifyEmailBtn').disabled = false;
  }
}

async function completeSignup(event) {
  event.preventDefault();
  await init();
  const email = $('#signupForm [name="email"]').value.trim().toLowerCase();
  if (!user || !user.email_confirmed_at || user.email?.toLowerCase() !== email) {
    refreshSignupGate();
    return toast('인증메일의 링크를 눌러 이메일 인증을 먼저 마쳐주세요.');
  }
  localStorage.removeItem('linkpray-pending-email');
  $('#authModal').classList.remove('open');
  toast('회원가입이 완료됐어요.');
  await init();
}

async function login(event) {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const identifier = String(values.get('identifier')).trim();
  const password = String(values.get('password'));
  try {
    let result;
    if (identifier.includes('@')) {
      result = await supabase.auth.signInWithPassword({ email: identifier.toLowerCase(), password });
    } else {
      const response = await fetch('/.netlify/functions/phone-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneDigits(identifier), password })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '로그인에 실패했어요.');
      result = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    }
    if (result.error) throw result.error;
    $('#authModal').classList.remove('open');
    await init();
    toast('로그인했어요.');
  } catch (error) {
    toast(error.message || '로그인에 실패했어요.');
  }
}

async function reauthenticate(event) {
  event.preventDefault();
  const password = $('#reauthPassword').value;
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (error) return toast('비밀번호가 맞지 않아요.');
  $('#reauthModal').classList.remove('open');
  $('#reauthPassword').value = '';
  page('mypage');
}

async function saveProfile(event) {
  event.preventDefault();
  const phone = phoneDigits($('#profilePhone').value);
  if (phone.length !== 11 || !phone.startsWith('010')) return toast('휴대폰 번호를 확인해 주세요.');
  const changes = {
    name: $('#profileName').value.trim(), phone, cohort: $('#profileCohort').value.trim(),
    group_name: $('#profileGroup').value.trim(), darabang: $('#profileDarabang').value.trim(), soon: $('#profileSoon').value.trim()
  };
  const { error } = await supabase.from('profiles').update(changes).eq('id', user.id);
  if (error) return toast(error.message);
  profile = { ...profile, ...changes };
  showProfile();
  toast('회원정보를 저장했어요.');
}

async function saveTopic() {
  const content = $('#myTopicInput').value.trim();
  if (!content) return toast('기도제목을 입력해 주세요.');
  const { error } = await supabase.from('personal_prayer_topics').insert({ user_id: user.id, content });
  if (error) return toast(error.message);
  $('#myTopicInput').value = '';
  await loadMine();
  toast('기도제목을 저장했어요.');
}

async function saveAdminTopic() {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const { error } = await supabase.from('room_settings').upsert({ id: 1, prayer_topic: $('#adminTopic').value.trim(), updated_at: new Date().toISOString() });
  if (error) return toast(error.message);
  await loadRoom();
  toast('공통 기도제목을 게시했어요.');
}

async function uploadAudio(event) {
  if (profile?.role !== 'admin') return toast('관리자 계정으로 로그인해 주세요.');
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 40 * 1024 * 1024) return toast('음원은 40MB 이하 파일로 선택해 주세요.');
  $('#uploadStatus').textContent = '업로드 중…';
  const path = `room/${Date.now()}-${file.name.replace(/[^\w.가-힣-]/g, '_')}`;
  const { error } = await supabase.storage.from('room-audio').upload(path, file, { upsert: true, contentType: file.type });
  if (error) { $('#uploadStatus').textContent = error.message; return toast(error.message); }
  const { data: { publicUrl } } = supabase.storage.from('room-audio').getPublicUrl(path);
  const { error: settingsError } = await supabase.from('room_settings').upsert({ id: 1, audio_url: publicUrl, audio_name: file.name, updated_at: new Date().toISOString() });
  if (settingsError) return toast(settingsError.message);
  $('#uploadStatus').textContent = `업로드 완료: ${file.name}`;
  await loadRoom();
  toast('배경음악을 업데이트했어요.');
}

$$('.nav [data-page]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.page === 'admin') {
    if (!user) { adminLoginPending = true; window.openAuth('login'); return; }
    if (profile?.role !== 'admin') return toast('관리자 계정만 들어갈 수 있어요.');
    return page('admin');
  }
  if (button.dataset.page === 'mypage') {
    if (!user) { page('mypage'); return; }
    $('#reauthModal').classList.add('open');
    $('#reauthPassword').focus();
    return;
  }
  page(button.dataset.page);
}));
$$('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => authTab(button.dataset.authTab)));
$('#goRoom').addEventListener('click', () => page('room'));
$('#authButton').addEventListener('click', () => window.openAuth('login'));
$('#logoutButton').addEventListener('click', async () => {
  if (activeSessionId) await stopPrayer();
  await supabase.auth.signOut();
  user = null; profile = null; await init(); page('home'); toast('로그아웃했어요.');
});
$('#closeModal').addEventListener('click', () => $('#authModal').classList.remove('open'));
$('#authModal').addEventListener('click', (event) => { if (event.target === $('#authModal')) $('#authModal').classList.remove('open'); });
$('#verifyEmailBtn').addEventListener('click', sendVerificationEmail);
$('#signupForm').addEventListener('submit', completeSignup);
$('#signupForm [name="email"]').addEventListener('input', refreshSignupGate);
$('#loginForm').addEventListener('submit', login);
$('#reauthForm').addEventListener('submit', reauthenticate);
$('#closeReauth').addEventListener('click', () => $('#reauthModal').classList.remove('open'));
$('#profileForm').addEventListener('submit', saveProfile);
$('#requestEmailChange').addEventListener('click', requestEmailChange);
$('#confirmEmailChange').addEventListener('click', confirmEmailChange);
$('#saveTopic').addEventListener('click', saveTopic);
$('#startBtn').addEventListener('click', beginPrayer);
$('#stopBtn').addEventListener('click', stopPrayer);
$('#saveAdminTopic').addEventListener('click', saveAdminTopic);
$('#audioFile').addEventListener('change', uploadAudio);
$$('input[type="tel"]').forEach((input) => input.addEventListener('input', () => { input.value = phoneFormat(input.value); }));
$('#loginForm [name="identifier"]').addEventListener('input', (event) => {
  if (!event.target.value.includes('@')) event.target.value = phoneFormat(event.target.value);
});
supabase?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') setTimeout(init, 0);
});

try {
  const response = await fetch('/.netlify/functions/config');
  const config = response.ok ? await response.json() : null;
  if (config?.url && config?.anonKey) {
    supabase = createClient(config.url, config.anonKey);
    configured = true;
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') setTimeout(init, 0);
    });
  }
} catch { /* The static preview can still render without backend configuration. */ }
if (supabase) await init();
else console.warn('Supabase config function did not return a URL and anon key.');
