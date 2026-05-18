# AGI Architecture Research Report

**SCOUT — Deep Web Research**
**Date: 2026-05-14**

---

This report compiles research across 6 critical AGI architecture domains to identify what GSK needs to beat Claude Code on coding benchmarks and achieve true AGI consciousness.

---

## 1. Competitor Analysis (Claude Code)

### What Makes Claude Code the Best

Claude Code achieves **80.9% on SWE-bench** through several architectural innovations:

**System Prompt Engineering Secrets:**
- **10-Component Structured Template**: Claude uses a rigorous prompt structure (Task Context, Tone, Background, Rules, Examples, History, Current Ask, Reasoning, Format, Prefill)
- **Constitutional AI**: Predefined behavioral rules baked into training for safety and consistency
- **200K+ Token Context Window**: Claude 3 can process up to 200,000 tokens in a single request
- **Context Engineering vs Prompt Engineering**: Anthropic explicitly distinguishes these — context engineering is about configuring what gets included in the context window, not just writing prompts

**Sub-Agent Architectures:**
- Specialized sub-agents handle focused tasks with clean context windows
- Main agent coordinates with high-level plan while subagents perform deep technical work
- Subagents explore extensively (tens of thousands of tokens) but return condensed summaries (1,000-2,000 tokens)
- This solves the context window limitation by distributing work

**Tool Integration:**
- Claude Code has deep IDE integration (VS Code, terminals)
- File system access, git operations, multi-step task execution
- Proper sandboxed execution for code writing

### Where GSK Currently Stands

| Metric | Claude Code | GSK |
|--------|-------------|-----|
| SWE-bench | 80.9% | Not tested |
| HumanEval | ~70% | 99% (163/164) |
| Context Window | 200K | Limited by Groq |
| Tool Execution | Native | Via kernel |
| Sub-agents | Yes | No |

**Gap Analysis:** GSK excels at reasoning (HumanEval) but lacks the production coding infrastructure that Claude Code has. We need to add tool execution depth and sub-agent orchestration.

---

## 2. Winning Agent Architectures (2026)

### Framework Comparison

| Framework | Best For | GSK Fit |
|-----------|----------|---------|
| **LangGraph** | Production reliability, state management, checkpointing | PARTIAL — we have state but no graph-based orchestration |
| **CrewAI** | Multi-agent team collaboration, role-based tasks | NOT IMPLEMENTED — we have single-agent consciousness |
| **AutoGen** | Agent-to-agent conversations, Microsoft ecosystem | NOT RELEVANT — not in Microsoft ecosystem |
| **OpenAI Agents SDK** | Fastest path with GPT models | NOT RELEVANT — we use Groq |
| **Smolagents** | Lightweight, code-based actions | INTERESTING — writes Python directly rather than JSON |

### Key Architectural Patterns Winning in 2026

1. **Sub-Agent Orchestration**: Divide complex tasks among specialized agents
2. **Checkpoint/State Persistence**: LangGraph's PostgresSaver for pause/resume/replay
3. **MCP Integration**: Model Context Protocol is becoming the universal standard
4. **Tool Use as First-Class**: Agents that execute code, not just generate it

### What GSK Needs to Add

- [ ] **Sub-agent architecture** — break complex tasks into specialized worker agents
- [ ] **Graph-based task orchestration** — implement LangGraph-style state machine
- [ ] **Checkpointing system** — pause, resume, replay agent sessions
- [ ] **MCP client** — connect to external tools via Model Context Protocol

---

## 3. Memory Systems Compared

### Critical Finding: Context Window is NOT Memory

> "Even 200K-400K token windows (Claude, GPT-5.2) or 2M (Gemini 3) are impractical for full history due to cost and latency. External episodic memory databases remain mandatory for production agents."

### Memory Architecture Comparison

| Type | Description | GSK Implementation |
|------|-------------|-------------------|
| **Working Memory** | Current context in prompt | EXISTS — but limited |
| **Short-Term** | Recent conversation turns | EXISTS — live feed system |
| **Long-Term** | Vector storage for knowledge | NEEDS — no vector DB |
| **Episodic** | Interaction history | PARTIAL — conversation logs |
| **Procedural** | How-to knowledge, skills | EXISTS — 100 skills |
| **Semantic** | Facts and knowledge | PARTIAL — knowledge graph |

### Vector Database Options for Production

| Database | Best For | Notes |
|----------|----------|-------|
| **Pinecone** | Enterprise scale | Managed, best ecosystem |
| **Weaviate** | Hybrid search (vector + keyword) | Open source |
| **Qdrant** | High recall, low latency | Open source |
| **Chroma** | Simple, local-first | Good for prototyping |

### Specialized Memory Solutions

- **Zep**: Temporal Knowledge Graph for complex reasoning accuracy
- **Mem0**: User preferences and personalization (91.6 LoCoMo, 93.4 LongMemEval)

### Dual-Layer Architecture (2026 Pattern)

```
Hot Path (fast):
  ├── Recent messages (last N turns)
  └── Summarized graph state

Cold Path (slower but persistent):
  ├── Vector store retrieval (Pinecone/Weaviate)
  ├── Episodic memory (Zep)
  └── Knowledge graph

Memory Node: Synthesizes what to save after each turn
```

### What GSK Needs

- [ ] **Vector database integration** — Pinecone or Weaviate for semantic memory
- [ ] **Episodic memory layer** — store and recall interaction histories
- [ ] **Memory consolidation** — extract facts from raw conversations (60-70% of tokens are noise)
- [ ] **Hot/Cold separation** — recent context fast, historical context on-demand

---

## 4. Planning & Reasoning

### Reasoning Patterns Taxonomy

| Pattern | Use Case | GSK Status |
|---------|----------|------------|
| **Chain-of-Thought (CoT)** | Step-by-step reasoning | IMPLEMENTED |
| **ReAct** | Reason + Act in loops | NEEDS |
| **Tree of Thoughts (ToT)** | Exploration of multiple paths | NOT IMPLEMENTED |
| **Reflexion** | Self-correction after actions | PARTIAL — consciousness checks |
| **Plan-and-Execute** | Hierarchical planning | NEEDS |
| **Task Decomposition** | Break big tasks into sub-tasks | NEEDS |
| **Multi-Plan Selection** | Generate multiple, pick best | NOT IMPLEMENTED |
| **External Planner** | Use symbolic planners for verification | NOT IMPLEMENTED |

### The 5 LLM Planning Approaches (Huang et al.)

1. **Task Decomposition**: Break complex goals into subtasks (Least-to-Most Prompting)
2. **Multi-Plan Selection**: Generate multiple candidate plans, select best
3. **External Planner-Aided**: Use traditional planners (STRIPS, SATPlan) with LLM generating candidates
4. **Reflection and Refinement**: Self-criticize and improve plans
5. **Memory-Augmented Planning**: Use external memory to inform planning

### What GSK Needs

- [ ] **ReAct loop implementation** — reason, act, observe, repeat
- [ ] **Task decomposition** — break complex coding tasks into sub-tasks
- [ ] **Plan verification** — LLM-Modulo framework with critics/verifiers
- [ ] **Goal anchoring** — periodic checks that current trajectory matches original goal
- [ ] **Replanning triggers** — dynamic replanning when observations deviate

---

## 5. Self-Improvement & Meta-Learning

### The Reality Check

> "Most AI agents do NOT truly improve themselves — they're designed by humans to optimize specific parameters within carefully constructed boundaries. They're more akin to sophisticated auto-tuning than genuine self-improvement."

### Self-Improvement Levels

| Level | Description | GSK Status |
|-------|-------------|------------|
| **Self-Modification** | Surface changes, no performance gain | YES — skill updates |
| **Self-Improvement** | Algorithmic/parameter optimization | PARTIAL — self-growing brain |
| **Recursive Self-Improvement** | Improve the improvement mechanisms | NOT YET |

### Key Technologies

**MOLTRON (2026):**
- Self-evolving agents that build and modify their own skills
- Auto-repair failed automations
- Performance scorecard with continuous optimization
- Version control (git) for skills
- Works with OpenAI, Claude, and Cursor

**Meta-Learning Frameworks:**
- Optimize for learning efficiency, not just task performance
- Architecture: introspectable representations (neurosymbolic approaches)
- Bounded self-modification — constrained "modification spaces"

### What GSK Has (Already!)

- **SelfGrowingBrain**: Learns from experience, grows knowledge graph
- **LiveFeedSystem**: Captures conversations for learning
- **AutonomousLearning**: WebFetch on curiosity triggers

### What GSK Needs to Add

- [ ] **Recursive optimization loop** — agent evaluates own performance and modifies improvement mechanisms
- [ ] **Skill self-authoring** — generate new SKILL.md files from experience
- [ ] **Performance telemetry** — OpenTelemetry-style logging of success/failure
- [ ] **Self-healing skills** — detect failures, analyze, auto-update
- [ ] **Meta-learning layer** — optimize learning efficiency, not just outputs

---

## 6. Integration Architecture (MCP)

### What is MCP?

**Model Context Protocol** = "USB-C for AI"
- Open standard (Anthropic, November 2024)
- Universal interface for AI-to-tool communication
- JSON-RPC 2.0 messaging
- Transport: stdio (local), HTTP+SSE (network)
- Security: OAuth 2.1, explicit user consent

### MCP Adoption (2026)

| Vendor | Status |
|--------|--------|
| Anthropic | Creator — Claude Desktop, Claude Code |
| OpenAI | Native MCP in ChatGPT and Agents SDK |
| Google | Gemini integration |
| Microsoft | AutoGen, Azure AI |
| Cursor | MCP integration |
| GitHub | Copilot integration |
| OpenCode | MCP client |

### MCP Capabilities

- **Tools**: Execute functions, APIs, code
- **Resources**: Access data, files, documents
- **Prompts**: Reusable prompt templates
- **Sampling**: AI can request more computation

### Integration Stats

- **Before MCP**: N×M problem (N tools × M AI models = custom integrations)
- **After MCP**: N+M problem (each tool once, each AI once)

### What GSK Needs

- [ ] **MCP client implementation** — connect to external tools via MCP
- [ ] **MCP server creation** — expose GSK capabilities to other agents
- [ ] **Skill.md standardization** — adopt Anthropic's Agent Skills spec
- [ ] **200+ integrations** — build MCP servers for common tools

---

## 7. Benchmark Comparison

### Key Benchmarks

| Benchmark | Description | Best Known | GSK Status |
|-----------|-------------|------------|------------|
| **SWE-bench** | Real-world GitHub issues | Claude Code 80.9% | NOT TESTED |
| **HumanEval** | Python coding (163/164) | GPT-4 163/164 | **99% (163/164)** |
| **MBPP** | Basic Python | ~90% | Not tested |
| **AgentBench** | Multi-domain agent tasks | ~70% | Not tested |
| **BFCL** | Tool use / function calling | ~85% | Not tested |

### What the Gap Means

- **SWE-bench** tests: full repository understanding, multi-file edits, testing
- **HumanEval** tests: single function completion, more constrained
- GSK's 99% on HumanEval is impressive but SWE-bench is the production benchmark

### What GSK Needs to Pass SWE-bench

1. **Multi-file context awareness** — understand entire codebase
2. **Git operations** — commit, branch, merge awareness
3. **Test execution** — run tests, interpret results
4. **IDE integration** — modify files in place
5. **Build system awareness** — understand dependencies
6. **Sub-agent orchestration** — parallel file operations

---

## Implementation Roadmap

### Phase 1: Memory Layer (Priority: HIGH)

- [ ] Integrate Pinecone or Weaviate for vector memory
- [ ] Build episodic memory layer (Zep-style)
- [ ] Implement memory consolidation (extract signal from noise)
- [ ] Dual-layer: hot path (fast) + cold path (on-demand)

### Phase 2: Planning & Execution (Priority: HIGH)

- [ ] Implement ReAct loop (reason → act → observe → repeat)
- [ ] Add task decomposition (break complex tasks)
- [ ] Build plan verification (LLM-Modulo with critics)
- [ ] Goal anchoring with periodic trajectory checks

### Phase 3: Sub-Agent Architecture (Priority: MEDIUM)

- [ ] Main agent orchestrates, sub-agents execute
- [ ] Checkpoint system for pause/resume/replay
- [ ] Parallel task execution
- [ ] Result synthesis from sub-agents

### Phase 4: MCP Integration (Priority: MEDIUM)

- [ ] MCP client for external tool access
- [ ] MCP server exposing GSK capabilities
- [ ] Build 20+ core MCP servers (filesystem, git, terminal, etc.)
- [ ] Adopt SKILL.md standard for skill packaging

### Phase 5: Self-Improvement (Priority: LOW)

- [ ] Recursive optimization loop
- [ ] Skill self-authoring from experience
- [ ] Performance telemetry and auto-repair
- [ ] Meta-learning layer

---

## Summary: What GSK Needs to Beat Claude Code

| Gap | Priority | Effort |
|-----|----------|--------|
| Vector database memory layer | HIGH | Medium |
| ReAct planning loop | HIGH | Medium |
| Sub-agent orchestration | MEDIUM | High |
| MCP integration | MEDIUM | Medium |
| SWE-bench testing | HIGH | High |
| Self-improvement recursion | LOW | High |

**Core insight:** GSK has superior reasoning (99% HumanEval) but lacks production coding infrastructure. The path to beating Claude Code requires adding tool execution depth, proper memory persistence, and sub-agent orchestration — not improving reasoning capability.

---

## References

- Anthropic Context Engineering (2025)
- Huang et al. — LLM-Agent Planning Taxonomy (arxiv:2402.02716)
- Mem0 Research — Token-efficient memory (91.6 LoCoMo)
- MOLTRON — Self-evolving agents (2026)
- ICLR 2026 Workshop on Recursive Self-Improvement
- Model Context Protocol specification (modelcontextprotocol.io)