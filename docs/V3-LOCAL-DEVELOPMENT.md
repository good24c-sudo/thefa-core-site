# THEFA Core V3 and Functional Console Lab V2

The public homepage explains one product: THE FA Core connects AI, agents, PCs and tools; restores relevant company context; plans and routes work; reviews and verifies outputs; preserves results and decisions. Its internal engines are capabilities of that single product. Public examples do not claim live provider connections.

The homepage preserves the existing wordmark, local font, design tokens, shared header/footer, Demo/Console/Contact routes and closed-account behavior. It stays static HTML/CSS/JavaScript. The functional Lab is a separate Node standard-library application in `lab/`, with no framework or dependency installation.

## Local surfaces

Run `tools/Start-Local.ps1` from PowerShell. It checks ports once and copies Lab source into the separate Desktop product directory `THEFA_Core_Console_V2_Codex_Work`. Existing directories or processes are preserved; a conflict fails explicitly. It starts hidden, loopback-only processes and writes their IDs into that directory's `local-processes.json`.

- Functional Console Lab: http://127.0.0.1:4173
- Public website preview: http://127.0.0.1:4174

The Lab presents a goal input, actual local tasks, approvals, artifacts, memory, resources and measured local usage. Advanced task/run/work-unit/QA/receipt data remains available below that primary experience. Lab source is included for review; the public website does not expose a functioning Console backend or link to a visitor's localhost.

## Execution boundaries

Local report generation writes real files and verifies them. Research/provider examples are explicitly MOCK. Approval handles a simulated action only; it never deploys. Retry reads a persistent checkpoint. Failover exercises two fake providers and cannot be mistaken for paid-provider availability. Ollama is used only when an existing local model is detected, for a read-only summary; there is no model download or external provider API call.

The Lab's resource-selection contract is a development test surface. It neither changes THE FA Router V2 nor grants production writer authority. GitHub, cloud providers, coding agents and other external tools remain disconnected/planned unless actual local evidence supports a narrower detected state.

## Reference disposition

The rejected Plus ZIP is reference material, not a product, design, architecture or UX authority. Its original SHA-256 is `15871181c8287b2f102de9d81b04861b7c7876db9d0b15a4edda70603d262880`. Reference extraction contains 13 files. Only its atomic-save pattern and separation of execution records inform the fresh implementation. Its login flow, Dashboard-first IA and unconnected execution path are not adopted. No claim is made that the old branch/ZIP QA proves V2 behavior.

## Validation

Run `python tools/validate-site.py` for bounded link/asset/heading/ID/JavaScript checks; run `node --test lab/tests/*.test.mjs` for execution/security tests. Browser QA covers 320/360/375/390/430 and 1280/1440/1920 widths, navigation, interactions, rendered assets, reduced motion and keyboard focus. Canary and exact-source receipts are saved outside the public repository tree. A preexisting duplicate h1 on the unchanged signup page is reported as such.

No main merge, production deployment, DNS/CNAME change, secret/OAuth change, production DB/API mutation or permission/billing change is part of this branch.
