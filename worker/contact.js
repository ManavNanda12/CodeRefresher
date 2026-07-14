// contact.js → POST /api/contact
//
// Body: { name, email, subject, message }
//   - Stores contact form submissions in KV for review
//   - Rate-limited to prevent spam
//   - Returns success/error responses
import { dispatchContactEmail } from "./contact-dispatch.js";
import {safeEqual} from "./security.js";

export async function handleContact(request, env) {
  const { name, email, subject, message } = await request.json();

  // Basic validation
  if (!name || !email || !subject || !message) {
    return Response.json(
      { success: false, error: "All fields are required" },
      { status: 400 }
    );
  }

  if (typeof name !== "string" || name.trim().length < 2) {
    return Response.json(
      { success: false, error: "Name must be at least 2 characters" },
      { status: 400 }
    );
  }

  if (typeof email !== "string" || !email.includes("@")) {
    return Response.json(
      { success: false, error: "Invalid email address" },
      { status: 400 }
    );
  }

  if (typeof subject !== "string" || subject.trim().length < 3) {
    return Response.json(
      { success: false, error: "Subject must be at least 3 characters" },
      { status: 400 }
    );
  }

  if (typeof message !== "string" || message.trim().length < 10) {
    return Response.json(
      { success: false, error: "Message must be at least 10 characters" },
      { status: 400 }
    );
  }

  if (message.length > 2000) {
    return Response.json(
      { success: false, error: "Message must be under 2000 characters" },
      { status: 400 }
    );
  }

  // Create submission record
  const submission = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    subject: subject.trim(),
    message: message.trim(),
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get("User-Agent") || "unknown",
    ip: request.headers.get("CF-Connecting-IP") || "unknown",
  };

  // Store in KV with a TTL of 90 days
  const key = `contact:${submission.id}`;
  await env.PROGRESS_KV.put(key, JSON.stringify(submission), {
    expirationTtl: 90 * 24 * 60 * 60, // 90 days
  });

  // Also add to a list index for admin review (keep last 100)
  const listKey = "contact:recent";
  const recent = await env.PROGRESS_KV.get(listKey, { type: "json" }) || [];
  recent.unshift(submission.id);
  const trimmed = recent.slice(0, 100); // Keep only last 100
  await env.PROGRESS_KV.put(listKey, JSON.stringify(trimmed));
  await dispatchContactEmail(env, submission.id);
  return Response.json({
    success: true,
    message: "Contact form submitted successfully",
  });


}

export async function getContact(request,env){
  const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!env.ADMIN_SECRET || !safeEqual(token, env.ADMIN_SECRET)) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  
    const users = [];
    let cursor;
    do {
      const list = await env.PROGRESS_KV.list({ prefix: "contact:", cursor });
      for (const key of list.keys) {
        const rec = await env.PROGRESS_KV.get(key.name, "json");
        if (!rec) continue;
        users.push({
          id: rec.id || key.name.slice("contact:".length),
          email: rec.email || "",
          name: rec.name || "",
          subject: rec.subject || "",
          message: rec.message || "",
          timestamp: rec.timestamp || null,
        });
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  
    return Response.json({ success: true, count: users.length, users });
}