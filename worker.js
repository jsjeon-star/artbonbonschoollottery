const ALLOWED_ORIGIN = '*';
const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000; // 30일

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return cors(new Response(null));
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── 이미지 업로드 ──
    if (request.method === 'POST' && path === '/upload') {
      return handleUpload(request, env);
    }

    // ── 이미지 조회 ──
    if (request.method === 'GET' && path.startsWith('/img/')) {
      return handleGetImg(path, env);
    }

    // ── 선생님 등록 ──
    if (request.method === 'POST' && path === '/teacher/register') {
      return handleTeacherRegister(request, env);
    }

    // ── 선생님 로그인 확인 ──
    if (request.method === 'POST' && path === '/teacher/login') {
      return handleTeacherLogin(request, env);
    }

    // ── 학생 QR 제출 ──
    if (request.method === 'POST' && path === '/student/submit') {
      return handleStudentSubmit(request, env);
    }

    // ── 학생 목록 조회 ──
    if (request.method === 'GET' && path.startsWith('/teacher/') && path.endsWith('/students')) {
      const code = path.split('/')[2];
      return handleGetStudents(code, request, env);
    }

    // ── 학생 삭제 ──
    if (request.method === 'DELETE' && path.startsWith('/teacher/') && path.includes('/student/')) {
      const parts = path.split('/');
      const teacherCode = parts[2];
      const studentId = parts[4];
      return handleDeleteStudent(teacherCode, studentId, request, env);
    }

    // ── 전체 학생 삭제 ──
    if (request.method === 'DELETE' && path.startsWith('/teacher/') && path.endsWith('/students')) {
      const code = path.split('/')[2];
      return handleDeleteAllStudents(code, request, env);
    }

    return errorRes('Not found', 404);
  }
};

/* ── 이미지 업로드 ── */
async function handleUpload(request, env) {
  try {
    const { image } = await request.json();
    if (!image) return errorRes('이미지 없음', 400);
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const id = Math.random().toString(36).slice(2, 8);
    await env.BUCKET.put(`img/${id}`, binary, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { uploadedAt: Date.now().toString() }
    });
    return jsonRes({ id });
  } catch (e) {
    return errorRes('업로드 실패: ' + e.message, 500);
  }
}

/* ── 이미지 조회 ── */
async function handleGetImg(path, env) {
  const id = path.slice(5);
  const obj = await env.BUCKET.get(`img/${id}`);
  if (!obj) return errorRes('이미지 없음', 404);
  return cors(new Response(obj.body, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=2592000',
    }
  }));
}

/* ── 선생님 등록 ── */
async function handleTeacherRegister(request, env) {
  try {
    const { code, name } = await request.json();
    if (!code || !name) return errorRes('코드와 이름을 입력하세요', 400);
    if (code.length < 4) return errorRes('코드는 4자 이상이어야 합니다', 400);

    const existing = await env.BUCKET.get(`teacher/${code}/info`);
    if (existing) return errorRes('이미 사용 중인 코드입니다', 409);

    const info = JSON.stringify({ code, name, createdAt: Date.now() });
    await env.BUCKET.put(`teacher/${code}/info`, info, {
      httpMetadata: { contentType: 'application/json' }
    });
    return jsonRes({ success: true, code, name });
  } catch (e) {
    return errorRes('등록 실패: ' + e.message, 500);
  }
}

/* ── 선생님 로그인 ── */
async function handleTeacherLogin(request, env) {
  try {
    const { code } = await request.json();
    if (!code) return errorRes('코드를 입력하세요', 400);
    const obj = await env.BUCKET.get(`teacher/${code}/info`);
    if (!obj) return errorRes('존재하지 않는 코드입니다', 404);
    const info = JSON.parse(await obj.text());
    return jsonRes({ success: true, name: info.name, code: info.code });
  } catch (e) {
    return errorRes('로그인 실패: ' + e.message, 500);
  }
}

/* ── 학생 QR 제출 ── */
async function handleStudentSubmit(request, env) {
  try {
    const { teacherCode, studentName, shareUrl } = await request.json();
    if (!teacherCode || !studentName || !shareUrl)
      return errorRes('필수 항목 누락', 400);

    // 선생님 존재 확인
    const teacher = await env.BUCKET.get(`teacher/${teacherCode}/info`);
    if (!teacher) return errorRes('선생님 코드를 찾을 수 없습니다', 404);

    // 학생 목록 불러오기
    const listObj = await env.BUCKET.get(`teacher/${teacherCode}/students`);
    const students = listObj ? JSON.parse(await listObj.text()) : [];

    // 30일 지난 항목 자동 삭제
    const now = Date.now();
    const filtered = students.filter(s => (now - s.createdAt) < EXPIRE_MS);

    // 새 학생 추가
    const id = Math.random().toString(36).slice(2, 10);
    filtered.push({ id, name: studentName, shareUrl, createdAt: now });

    await env.BUCKET.put(`teacher/${teacherCode}/students`,
      JSON.stringify(filtered),
      { httpMetadata: { contentType: 'application/json' } }
    );
    return jsonRes({ success: true, id });
  } catch (e) {
    return errorRes('제출 실패: ' + e.message, 500);
  }
}

/* ── 학생 목록 조회 ── */
async function handleGetStudents(code, request, env) {
  try {
    // 선생님 인증 (Authorization 헤더)
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${code}`) return errorRes('인증 실패', 401);

    const listObj = await env.BUCKET.get(`teacher/${code}/students`);
    if (!listObj) return jsonRes({ students: [] });

    const students = JSON.parse(await listObj.text());
    const now = Date.now();
    const valid = students.filter(s => (now - s.createdAt) < EXPIRE_MS);
    return jsonRes({ students: valid });
  } catch (e) {
    return errorRes('조회 실패: ' + e.message, 500);
  }
}

/* ── 학생 개별 삭제 ── */
async function handleDeleteStudent(teacherCode, studentId, request, env) {
  try {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${teacherCode}`) return errorRes('인증 실패', 401);

    const listObj = await env.BUCKET.get(`teacher/${teacherCode}/students`);
    if (!listObj) return jsonRes({ success: true });

    const students = JSON.parse(await listObj.text());
    const updated = students.filter(s => s.id !== studentId);
    await env.BUCKET.put(`teacher/${teacherCode}/students`,
      JSON.stringify(updated),
      { httpMetadata: { contentType: 'application/json' } }
    );
    return jsonRes({ success: true });
  } catch (e) {
    return errorRes('삭제 실패: ' + e.message, 500);
  }
}

/* ── 전체 학생 삭제 ── */
async function handleDeleteAllStudents(code, request, env) {
  try {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${code}`) return errorRes('인증 실패', 401);
    await env.BUCKET.put(`teacher/${code}/students`, JSON.stringify([]),
      { httpMetadata: { contentType: 'application/json' } }
    );
    return jsonRes({ success: true });
  } catch (e) {
    return errorRes('삭제 실패: ' + e.message, 500);
  }
}

/* ── 유틸 ── */
function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, headers });
}

function jsonRes(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  }));
}

function errorRes(msg, status) {
  return jsonRes({ error: msg }, status);
}
