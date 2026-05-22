# OrbitHub OS -- app.orbithubos.pt
Actualizado: 2026-05-22T19:23:16.217Z

Conteudo extraido de app.orbithubos.pt (OrbitHub OS) em 22/05/2026.

Sistema de gestão completo para oficinas mecânicas e centros automotivos, com foco em rastreamento GPS, gestão financeira e integração com WhatsApp.
## 🚀 Funcionalidades Principais
### 🏢 Gestão Multi-Tenant (Super Admin)
- Gestão centralizada de múltiplas empresas/oficinas
- Controlo de planos (Básico, Pro, Enterprise) e estado de subscrição
- Dashboard global de empresas registadas
### 🚗 Gestão Operacional
- **Ordens de Serviço (OS):** Criação, edição e acompanhamento de status
- **Orçamentos:** Geração de orçamentos com ID único (ex: ORC-2026/001), dados reais do Prisma, alteração de estado e download de PDF
- **Integração OS/Orçamento:** Importação direta de orçamentos aprovados para novas Ordens de Serviço
- **Veículos:** Registo completo com validação dinâmica de ano e agenda de manutenção programada
- **Clientes:** Gestão de base de dados com importação CSV em massa
- **Fotos Antes/Depois:** Upload de fotos por OS com visualização em lightbox e eliminação individual
### 📍 Rastreamento GPS em Tempo Real
[Ficheiro: pages/_app.tsx]
import ../styles/globals.css
function NavigationProgress() {
const router = useRouter()
const barRef = useRef(null)
const timerRef = useRef | null>(null)
const start = () => {
const bar = barRef.current
bar.style.width = '0%'
bar.style.opacity = '1'
bar.style.transition = width 0.3s ease
const tick = () =>  %`
if (w < 85) timerRef.current = setTimeout(tick, 150)
timerRef.current = setTimeout(tick, 50)
if (timerRef.current) clearTimeout(timerRef.current)
bar.style.transition = width 0.2s ease
bar.style.width = '100%'
setTimeout(() =>  , 250)
router.events.on(routeChangeStart
router.events.on(routeChangeComplete
router.events.on(routeChangeError
[Ficheiro: pages/agendar/[tenantSlug].tsx]
services: ServiceRow[]
function pad(n: number)
function toDateInput(d: Date)  -$ -$ ` }
export default function AgendarPublico( : Props) {
const refFromLink = typeof router.query.ref === 'string ? router.query.ref.trim().toUpperCase() :
const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
const [serviceId, setServiceId] = useState ('')
const [techId, setTechId] = useState ('')
const [date, setDate] = useState (() => toDateInput(new Date(Date.now() + 24 * 60 * 60 * 1000)))
const [slots, setSlots] = useState< []>([])
const [slot, setSlot] = useState<  | null>(null)
const [loadingSlots, setLoadingSlots] = useState(false)
const [error, setError] = useState ('')
const [form, setForm] = useState( )
const setF = (k: keyo
[Ficheiro: pages/api/admin/setup.ts]
const schema = z.object({
tenantName: z.string().min(2),
tenantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
email: z.string().email(),
name: z.string().min(2),
password: z.string().min(8).regex(
/^(?=.*[A-Z])(?=.*\d).+$/,
A password deve ter pelo menos 8 caracteres, uma maiúscula e um número
setupKey: z.string(),
export default async function handler(req: NextApiRequest, res: NextApiResponse)
if (req.method !== 'POST') return res.status(405).end()
const parsed = schema.safeParse(req.body)
if (!parsed.success) return res.status(400).json( )
const setupKey = process.env.SETUP_KEY
if (parsed.data.setupKey !== setupKey)  )
const exists = await prisma.tenant.findUnique(  })
if (exists) return res.status(409).json( )
const tenant = await prisma.tenant.create({
[Ficheiro: pages/api/agenda/[id].ts]
status: z.enum(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
title: z.string().min(1).optional(),
description: z.string().optional(),
notes: z.string().optional(),
technicianId: z.string().nullable().optional(),
export default async function handler(req: NextApiRequest, res: NextApiResponse)  )
const role = (session.user as any).role as string
const tenantId = await resolveTenantId(session, req)
const appt = await prisma.appointment.findFirst( )