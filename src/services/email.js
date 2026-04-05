const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendVerificationCode(to, code) {
  // 이메일 설정이 없으면 콘솔 출력으로 폴백
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log(`[인증코드] ${to} → ${code}`);
    return;
  }

  await transporter.sendMail({
    from: `"Osprey" <${process.env.GMAIL_USER}>`,
    to,
    subject: '[Osprey] 이메일 인증코드',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #000;">Osprey 이메일 인증</h2>
        <p>아래 인증코드를 입력해주세요.</p>
        <div style="
          font-size: 36px;
          font-weight: bold;
          letter-spacing: 8px;
          text-align: center;
          padding: 24px;
          background: #f5f5f5;
          border-radius: 12px;
          margin: 24px 0;
        ">${code}</div>
        <p style="color: #888; font-size: 14px;">
          이 코드는 10분간 유효합니다.<br>
          본인이 요청하지 않았다면 이 메일을 무시하세요.
        </p>
      </div>
    `,
  });
}

module.exports = { sendVerificationCode };
