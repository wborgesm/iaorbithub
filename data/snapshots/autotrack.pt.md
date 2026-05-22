# Autotrack -- autotrack.pt
Actualizado: 2026-05-22T19:25:16.271Z

Conteudo extraido de autotrack.pt (Autotrack) em 22/05/2026.

[Ficheiro: app/admin/chatbot/page.tsx]
geminiDailyLimit: number;
geminiRequestsToday: number;
geminiTotalRequests: number;
geminiKeyMasked: string;
hasGeminiKey: boolean;
auditApiPublicRead: boolean;
pergunta_pt_pt: string;
pergunta_pt_br: string | null;
resposta_pt_pt: string;
resposta_pt_br: string | null;
insight_vendas: string | null;
local_entry_id: number | null;
reviewed_at: string | null;
export default function ChatbotAdminPage() {
const [authed, setAuthed] = useState (null);
const [password, setPassword] = useState('');
const [loginError, setLoginError] = useState (null);
[Ficheiro: app/api/chatbot/ask/route.ts]
function clientIp(req: NextRequest): string
export async function POST(req: NextRequest)  ;
const question = typeof body.question === 'string ? body.question.trim() :
if (!question)  ,  );
const history = normalizeHistory(body.history);
return NextResponse.json( );
const msg = e instanceof Error ? e.message : Erro ao processar a pergunta.
if (isGeminiQuotaError(msg))  );
return NextResponse.json( ,  );
[Ficheiro: app/api/chatbot/audit/route.ts]
const SESSION_GAP_MS = 30 * 60 * 1000;
const DEFAULT_SESSION_LIMIT = 40;
const MAX_SESSION_LIMIT = 100;
type AuditMessage =  ;
export type AuditConversation = {
messages: AuditMessage[];
primarySource: 'ai' | 'local';
needsReview: boolean;
abandonmentReason?: string;
type FaqSuggestionInput =  ;
async function ensureAuditTables(): Promise
function hasValidAuditApiKey(req: NextRequest): boolean {
const expected = process.env.CHATBOT_AUDIT_API_KEY?.trim();
if (!expected) return false;
const bearer = req.headers.get(authorization
[Ficheiro: app/api/checkout/route.ts]
from @/lib/stripe-checkout
export async function POST(req: NextRequest)
const parsed = publicCheckoutSchema.safeParse(body);
if (!parsed.success)  ,
const data = parsed.data;
if (!isStripeConfigured()) {
return NextResponse.json(
const provider = 'stripe' as const;
req.headers.get(x-forwarded-host
) || req.headers.get('host') || undefined;
const order = await createCheckoutOrder({
customerName: data.name,
customerEmail: data.email,
customerPhone: data.phone,
customerNif: data.nif,
planSlug: data.plan_slug,
vehicleCount: data.vehicle_count,
billingCycle: data.billing_cycle,
commitmentType: data.commitment_type,
deviceOption: data.device_option,
paymentProvider: provider,
data.billing_cycle === 'monthly'
[Ficheiro: app/api/checkout/verify/route.ts]
export async function GET(req: NextRequest)  ,  );
const order = await getOrderByReference(ref);
if (order.status === 'paid')  );
if (order.payment_provider === 'stripe' && order.stripe_session_id && process.env.STRIPE_SECRET_KEY)  );
const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
if (session.payment_status === 'paid') {
await markOrderPaid(ref,  );
const updated = await getOrderByReference(ref);
if (updated) await notifyPaidOrder(updated);
if (order.payment_provider === 'sumup' && order.sumup_checkout_id) {
const sumupStatus = await getSumUpCheckoutStatus(order.sumup_checkout_id);
if (sumupStatus === 'PAID || sumupStatus ===