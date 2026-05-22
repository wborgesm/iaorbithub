# Rinosat -- app.rinosat.com
Actualizado: 2026-05-22T19:24:15.847Z

Conteudo extraido de app.rinosat.com (Rinosat) em 22/05/2026.

[Ficheiro: app/checkout/[id]/page.tsx]
export default async function CheckoutPage( : Props)
const weeklyPrice = Number(searchParams.price ?? vehicle.baseWeeklyPrice);
const weeks = Number(searchParams.weeks ?? 1);
const deposit = vehicle.depositAmount;
const subtotal = weeklyPrice * weeks;
const total = subtotal + deposit;
[Ficheiro: app/checkout/success/page.tsx]
export default function SuccessPage() {
Reserva Confirmada!</h1>
A tua reserva foi processada com sucesso. Receberás um email de confirmação em breve.
Dirije-te ao parceiro na data acordada para levantar o veículo.
O parceiro entrará em contacto para confirmar os detalhes da entrega.
Lembra-te de levar o teu documento de identificação e carta de condução.
[Ficheiro: app/conta/cmd/page.tsx]
export default function CMDPage() {
const router = useRouter();
const [step, setStep] = useState<"intro" | "verify" | "done">("intro");
const [nif, setNif] = useState("");
const [phone, setPhone] = useState("");
const [code, setCode] = useState("");
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
async function handleRequestCode(e: React.FormEvent) {
body: JSON.stringify( ),
if (!res.ok) throw new Error(Erro ao enviar código
async function handleVerify(e: React.FormEvent) {
if (!res.ok) throw new Error(Código inválido
[Ficheiro: app/conta/page.tsx]
export default function ContaPage() {
const [user, setUser] = useState(null);
const [rentals, setRentals] = useState([]);
const [loading, setLoading] = useState(true);
async function load() {
const [userRes, rentalsRes] = await Promise.all([
fetch(/api/rentals/my
if (userRes.ok) setUser(await userRes.json());
if (rentalsRes.ok) setRentals(await rentalsRes.json());
async function handleLogout()  );
window.location.href = "/";
{user.cmdVerified ? (
Identidade Verificada
Chave Móvel Digital ativa
Verificação de Identidade
Opcional — Chave Móvel Digital
Aumenta a confiança com o
[Ficheiro: app/layout.tsx]
const manrope = Manrope( );
export const metadata: Metadata =  ,
description: "Marketplace OrbitHub OS para estafetas e motoristas TVDE em Portugal. Aluguer semanal de motos e carros com propostas inteligentes.",
metadataBase: new URL("https:
function OrbitLogo( :  )
const FOOTER_TRUST = [
export default function RootLayout( :  )
Marketplace de aluguer de veículos para estafetas e motoristas TVDE em Portugal.
<div className="mt-5 flex item
[Ficheiro: app/login/page.tsx]
export default function LoginPage() {
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
async function handleSubmit(e: React.FormEvent) {
const data = await res.json();
if (!res.ok) throw new Error(data.error || Erro ao iniciar sessão
router.push(data.role === "PARTNER" ? /partner/dashboard
Bem-vindo de volta</h1>
Inicia sessão na tua conta OrbitRent
setEmail(e.target.value)}
placeholder=tu@exemplo.pt
setPassword(e.target.value)}
[Ficheiro: app/partner/dashboard/page.tsx]
interface RentalRequest  ;
export default function PartnerDashboard() {
const [stats, setStats] = useState(null);
const [vehicles, setVehicles] = useState([]);
const [requests, setRequests] = useState([]);
const [statsRes, vehiclesRes, requestsRes] = await Promise.all([
fetch(/api/partner/stats
fetch(/api/partner/vehicles
fetch(/api/partner/requests
if (statsRes.ok) setStats(await statsRes.json());