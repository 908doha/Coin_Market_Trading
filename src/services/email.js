const nodemailer = require('nodemailer');

async function sendVerificationCode(to, code) {
  // 이메일 설정이 없으면 콘솔 출력 (Railway 로그에서 확인 가능)
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log(`[인증코드] ${to} → ${code}`);
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: `"Osprey" <${process.env.GMAIL_USER}>`,
      to,
      subject: '[Osprey] 이메일 인증코드',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2>🦅 Osprey 이메일 인증</h2>
          <p>아래 인증코드를 입력해주세요.</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;
            padding:24px;background:#f5f5f5;border-radius:12px;margin:24px 0">${code}</div>
          <p style="color:#888;font-size:14px">이 코드는 10분간 유효합니다.</p>
        </div>`,
    });
  } catch (err) {
    // 이메일 전송 실패시 콘솔만 출력, 회원가입은 계속 진행
    console.error(`[이메일 오류] ${err.message}`);
    console.log(`[인증코드 폴백] ${to} → ${code}`);
  }
}

module.exports = { sendVerificationCode };
