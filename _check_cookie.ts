import "dotenv/config";
import { parse as parseCookieHeader } from "cookie";
const cookieHeader = 'app_session_id=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJvcGVuSWQiOiJsb2NhbF9yRkxGTFdoTU9TZVdwT3RtY0ZOZERWekEiLCJuYW1lIjoiQWRtaW4iLCJleHAiOjE3ODUwMTUyMzV9.QsB9r6T7hrcdeKX2IKWDh4Ogq96f2mHR1zPGxZPMCcM; Max-Age=86400; Path=/; Expires=Sat, 25 Jul 2026 21:33:55 GMT; HttpOnly; SameSite=Lax,app_refresh=9bcb0cfe331aac5a668f1027f1ef6a6825a41524906c214da9dad592b0af14ba; Max-Age=2592000; Path=/api/trpc; Expires=Sun, 23 Aug 2026 21:33:55 GMT; HttpOnly; SameSite=Lax';
const cookies = parseCookieHeader(cookieHeader);
console.log("Cookies:", cookies);
console.log("app_session_id:", cookies["app_session_id"]);