function meetingNotification({ name, email, startFormatted, endFormatted, tz, meetLink, message, recipients = [] }) {
  const recipientsText = recipients && recipients.length ? recipients.join(', ') : '';
  return `
    <div style="font-family: Arial, sans-serif;">
      <p>Hi ${name},</p>
      <p><strong>User Email:</strong> ${email}</p>
      <p>Your meeting is scheduled for <strong>${startFormatted}</strong> to <strong>${endFormatted}</strong> (${tz}).</p>
      <p>Join Google Meet: <a href="${meetLink}" target="_blank">${meetLink}</a></p>
      <p><strong>Message:</strong> ${message}</p>
      <p><strong>Recipients:</strong> ${recipientsText}</p>
      <p><em>Sent to admin + team members</em></p>
      <p>Thanks,</p>
      <p>Your Team</p>
    </div>
  `;
}

module.exports = { meetingNotification };
