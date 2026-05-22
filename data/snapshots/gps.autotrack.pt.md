# Autotrack GPS -- gps.autotrack.pt
Actualizado: 2026-05-22T19:23:18.537Z

Conteudo extraido de gps.autotrack.pt (Autotrack GPS) em 22/05/2026.

# Autotrack GPS — Painel Admin
Painel de administração do sistema **Autotrack GPS**, construído com Next.js 16 (App Router). Gere clientes, dispositivos, planos de subscrição e pagamentos.
| Camada | Tecnologia |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, Leaflet |
| Backend | Next.js API Routes (Node.js) |
| Base de dados | PostgreSQL (via `pg` pool) |
| GPS backend | Traccar (proxy interno) |
| Autenticação | JWT (access 4h + refresh 7d, cookies httpOnly) |
| Pagamentos | Stripe Checkout + Webhooks, SumUp, OrbitHub CRM |
| Email | Nodemailer (SMTP local / Postfix) |
| Processo | PM2 (porta 3001) |
| Testes | Jest + ts-jest |
O sistema tem 5 roles com acesso hierárquico:
| `superadmin` | Tudo — incluindo Assistente AI, Utilizadores, Planos, Configurações |
| `admin` | Dashboard, Veículos, Grupos, Condutores, Relatórios, Utilizadores, Faturação |
| `support` | Dashboard, Relatórios, Eventos, Alertas, Veículos |
| `client_owner` | Dashboard próprio, Veículos, Minha Conta (faturação) |
| `client_user` | Dashboard e Replay apenas |
### Autenticação dual
O login tenta dois fluxos em sequência:
1. **Staff** — tabela `admin_user` (por username ou email)
2. **Cliente** — tabela `clients` por email; cria `admin_user` on-the-fly com `role='client_owner'`
JWT inclui: `id`, `username`, `role`, `traccar_user_id`, `client_id`.
│   ├── login/           # Login (staff + cliente), LoginForm com aurora animada
│   └── register/        # Registo de novos clientes
│   ├── DashboardShell.tsx        # Layout principal + nav por role + sidebar slide-in
│   ├── dashboard/                # Mapa ao vivo (Leaflet + Traccar WebSocket)
│   │   ├── hooks/useDeviceData.ts
│   │   └── components/           # DeviceCard, AlertsPanel, MapToolbar
│   ├── devices/                  # Gestão de veículos (ex-"Dispositivos GPS")
[Ficheiro: app/(auth)/layout.tsx]
export const metadata: Metadata =
export default function AuthLayout( :  )
[Ficheiro: app/(auth)/login/LoginForm.tsx]
export default function LoginForm() {
const [username, setUsername] = useState('')
const [password, setPassword] = useState('')
const [showPass, setShowPass] = useState(false)
const [error, setError] = useState('')
const [loading, setLoading] = useState(false)
const [remember, setRemember] = useState(false)
const searchParams = useSearchParams()
const isSuspensa = searchParams.get('suspensa') === '1'
const motivoRaw = searchParams.get('motivo') ?? ''
const motivoLabel = motivoRaw === cancelamento_contrato
? cancelamento de contrato
const [time, setTime] = useState('')
const [coords, setCoords] = useState( )
const [vehicles, setVehicles] = useState([
const canvasRef = useRef(null)
[Ficheiro: app/(auth)/login/page.tsx]
export default function LoginPage() {
= JSON.parse(saved) as
if (u) setUsername(u)
if (p) setPassword(p)
const canvas = canvasRef.current
const ctx = canvas.getContext('2d')
window.addEventListener('resize', set)
[0, 1], [0, 2], [1, 6], [2, 3], [0, 4], [1, 5], [5, 7], [2, 8],
let t = 0, raf: number
[Ficheiro: app/(auth)/register/page.tsx]
export default function RegisterPage() {
const [step, setStep] = useState(1)
const [success, setSuccess] = useState(false)
const [form, setForm] = useState( )
function update(key: string, val: string | number)  ))
function validateStep1() {
if (!form.name.trim()) return Nome é obrigatório
if (!form.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return Email inválido
if (form.password.length < 8) return Password deve ter mínimo 8 caracteres
if (form.password !== form.confirmPassword) return Passwords não coincidem
function validateStep2()
async function handleSubmit()  ,
body: JSON.stringify(form),
const data = await res.json()
[Ficheiro: app/(dashboard)/AdminShell.tsx]
export default function AdminShell( :  )
[Ficheiro: app/(dashboard)/ChromePanelContext.tsx]
export type ChromePanelOptions =
type ChromePanelCtx =