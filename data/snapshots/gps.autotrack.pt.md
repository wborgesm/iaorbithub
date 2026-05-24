# Autotrack GPS -- gps.autotrack.pt
Actualizado: 2026-05-24T18:26:02.831Z

**Documento de Conhecimento: Autotrack GPS**

**Descrição do Serviço/Produto**
O Autotrack GPS é um sistema de gestão de veículos que oferece uma solução completa para gerir a frota de veículos, dispositivos GPS, planos de subscrição e pagamentos. O sistema é construído com Next.js 16 (App Router) e utiliza tecnologias como React, Tailwind CSS, Leaflet e PostgreSQL.

**Funcionalidades e Páginas Disponíveis**
O Autotrack GPS oferece as seguintes funcionalidades e páginas:

* Painel de administração para gerir clientes, dispositivos, planos de subscrição e pagamentos
* Páginas de login e registo para utilizadores
* Dashboard para visualizar informações em tempo real sobre a frota de veículos
* Páginas para gerir dispositivos, grupos, condutores, relatórios e eventos
* Páginas para configurar alertas e notificações
* Páginas para gerir planos de subscrição e pagamentos

**Planos e Preços**
Não há informações disponíveis sobre planos e preços no conteúdo fornecido.

**Como Funciona (Processo, Passos)**
O sistema de autenticação dual tenta dois fluxos em sequência:

1. Autenticação de staff: tabela `admin_user` (por username ou email)
2. Autenticação de cliente: tabela `clients` por email; cria `admin_user` on-the-fly com `role='client_owner'`

O sistema utiliza JWT (access 4h + refresh 7d, cookies httpOnly) para autenticação.

**Contactos e Suporte**
Não há informações disponíveis sobre contactos e suporte no conteúdo fornecido.

**Limitações ou Requisitos Conhecidos**
Não há informações disponíveis sobre limitações ou requisitos conhecidos no conteúdo fornecido. No entanto, é mencionado que o sistema utiliza tecnologias específicas, como Next.js 16 (App Router), React, Tailwind CSS, Leaflet e PostgreSQL, o que pode implicar requisitos específicos para a execução do sistema. Além disso, o sistema utiliza autenticação dual, o que pode ter implicações de segurança.