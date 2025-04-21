/*************************************************************
 * Global Settings (Provider / Model)
 *************************************************************/
window.llmProvider = window.llmProvider || "openai";
// For OpenAI, possible options: "o3" (maps to "gpt-3.5-turbo") or "4o-mini" (maps to "gpt-4o-mini")
// For Claude, for example, "claude-3-7-sonnet-20250219"
// Gemini will use the fixed endpoint below.
window.llmModel = window.llmModel || "o3";

/*************************************************************
 * Unified LLM Helper Function: callLLM
 *
 * - For OpenAI: Uses our conventional chat payload.
 * - For Gemini: Uses the payload with "system_instruction" and "contents".
 * - For Claude: Uses the payload with "model", "system", "messages" and "stream": true.
 *************************************************************/
async function callLLM(systemPrompt, userText) {
  if (window.llmProvider === "openai") {
    // Map openai models: "o3" → "gpt-3.5-turbo", "4o-mini" → "gpt-4o-mini"
    let openaiModel;
    if (window.llmModel === "o3") {
      openaiModel = "gpt-3.5-turbo";
    } else if (window.llmModel === "4o-mini") {
      openaiModel = "gpt-4o-mini";
    } else {
      openaiModel = window.llmModel;
    }
    const endpoint = "https://llmfoundry.straive.com/openai/v1/chat/completions";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          model: openaiModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: [{ type: "text", text: userText }] }
          ]
        })
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message);
      }
      return data?.choices?.[0]?.message?.content;
    } catch (error) {
      throw new Error(`OpenAI call failed: ${error.message}`);
    }
  } else if (window.llmProvider === "gemini") {
    // Gemini payload structure and endpoint
    const body = JSON.stringify({
      "system_instruction": {
        "parts": [
          {
            "text": systemPrompt
          }
        ]
      },
      "contents": [
        {
          "role": "user",
          "parts": [
            {
              "text": userText
            }
          ]
        }
      ],
      "generationConfig": {
        "temperature": 0
      }
    });
    const endpoint = "/gemini/v1beta/models/gemini-2.0-flash-lite-001:streamGenerateContent?alt=sse";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      return await response.json();
    } catch (error) {
      throw new Error(`Gemini API call failed: ${error.message}`);
    }
  } else if (window.llmProvider === "claude") {
    // Claude payload structure and endpoint
    const body = JSON.stringify({
      "model": window.llmModel || "claude-3-7-sonnet-20250219",
      "max_tokens": 4096,
      "system": systemPrompt,
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": userText
            }
          ]
        }
      ],
      "stream": true,
      "temperature": 0
    });
    const endpoint = "/anthropic/v1/messages";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      return await response.json();
    } catch (error) {
      throw new Error(`Claude API call failed: ${error.message}`);
    }
  } else {
    throw new Error("Unsupported provider: " + window.llmProvider);
  }
}


/*************************************************************
 * Initialize Mermaid.js
 *************************************************************/
function initializeMermaid() {
  if (!window.mermaidInitialized) {
    mermaid.initialize({ startOnLoad: true, theme: 'default', logLevel: 5 });
    window.mermaidInitialized = true;
  }
}

/*************************************************************
 * Global variables and Default Ignore Patterns
 *************************************************************/
window.ingestedCode = "";  // Combined textual content of included files
window.ingestResults = { summary: "", directory: "", files: "" };

const DEFAULT_IGNORE_PATTERNS = new Set([
  "*.pyc", "__pycache__", ".git", ".github", ".venv", "env", "venv", "node_modules",
  "bower_components", "*.class", "*.jar", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.ico",
  "*.pdf", "*.mp4", "*.mp3", "dist", "build"
]);

/*************************************************************
 * Ingest Code (ZIP or single files) with patterns & slider
 *************************************************************/
document.getElementById('ingestBtn').addEventListener('click', () => {
  const files = document.getElementById('codeFile').files;
  processFiles(files);
});

async function processFiles(files) {
  if (!files || files.length === 0) {
    alert("No file provided.");
    return;
  }
  
  const ingestErrorEl = document.getElementById('ingestError');
  ingestErrorEl.classList.add('d-none');
  ingestErrorEl.innerText = '';

  window.ingestResults = { summary: "", directory: "", files: "" };
  window.ingestedCode = ""; // Clear old ingestion data

  try {
    const patternType = document.getElementById('patternType').value;
    const patternValue = document.getElementById('patternValue').value.trim();
    let userPatterns = new Set();
    if (patternValue) {
      const splitted = patternValue.split(/[\s,]+/).filter(Boolean);
      splitted.forEach((p) => userPatterns.add(normalizePattern(p)));
    }
    let ignorePatterns = new Set(DEFAULT_IGNORE_PATTERNS);
    let includePatterns = null;
    if (patternType === 'include' && userPatterns.size > 0) {
      includePatterns = userPatterns;
      for (let p of userPatterns) { ignorePatterns.delete(p); }
    } else if (patternType === 'exclude' && userPatterns.size > 0) {
      for (let p of userPatterns) { ignorePatterns.add(p); }
    }
    const maxFileBytes = sliderToBytes(document.getElementById('fileSizeSlider').value);
    const rootNode = {
      name: "root",
      type: "directory",
      children: [],
      size: 0,
      file_count: 0,
      dir_count: 0,
      path: "/"
    };

    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        await processZipFile(file, rootNode, ignorePatterns, includePatterns, maxFileBytes);
      } else {
        if (shouldExclude(file.name, ignorePatterns)) continue;
        if (includePatterns && !shouldInclude(file.name, includePatterns)) continue;
        if (file.size > maxFileBytes) continue;
        const fileContent = await file.text().catch(() => null);
        insertFileNode(
          rootNode,
          file.name,
          file.size,
          isLikelyTextFile(file.name) ? fileContent : '[Non-text file]'
        );
      }
    }
    computeStats(rootNode);
    const fileCount = rootNode.file_count;
    const totalSize = rootNode.size;
    window.ingestResults.summary =
      `Total files ingested: ${fileCount}\n` +
      `Total size: ${humanFileSize(totalSize)}\n`;
    window.ingestResults.directory = buildTreeString(rootNode);

    const extractedFiles = [];
    collectFileContents(rootNode, extractedFiles, maxFileBytes);
    let bigFilesString = "";
    let combinedCode = "";
    const sep = "=".repeat(50);
    extractedFiles.forEach(f => {
      bigFilesString += `${sep}\nFile: ${f.path}\n${sep}\n${f.content}\n\n`;
      combinedCode += `\n\n/********* ${f.path} *********/\n${f.content}\n`;
    });
    window.ingestResults.files = bigFilesString.trim();
    window.ingestedCode = combinedCode.trim();

    openIngestionResultsModal();
  } catch (err) {
    ingestErrorEl.innerText = "Error ingesting code: " + err.message;
    ingestErrorEl.classList.remove('d-none');
  }
}

/*******************************************************************
 * Helper Functions for ZIP Processing, Patterns, and Directory
 *******************************************************************/
async function processZipFile(zipFile, rootNode, ignorePatterns, includePatterns, maxFileSize) {
  const arrayBuffer = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const filesList = Object.keys(zip.files);
  for (let relPath of filesList) {
    const zipEntry = zip.files[relPath];
    if (zipEntry.dir) {
      buildDirectoryNodes(rootNode, relPath.split('/'));
      continue;
    }
    if (shouldExclude(relPath, ignorePatterns)) continue;
    if (includePatterns && !shouldInclude(relPath, includePatterns)) continue;
    const fileSize = zipEntry._data?.uncompressedSize || 0;
    if (fileSize > maxFileSize) continue;
    let content = '[Non-text file]';
    if (isLikelyTextFile(relPath) && fileSize > 0) {
      const fileData = await zipEntry.async("string").catch(() => null);
      if (fileData) {
        content = relPath.endsWith('.ipynb') ? processNotebook(fileData, relPath) : fileData;
      }
    }
    insertFileNode(rootNode, relPath, fileSize, content);
  }
}

function buildDirectoryNodes(root, segments) {
  let current = root;
  for (let seg of segments) {
    if (!seg) continue;
    let child = current.children.find(c => c.name === seg && c.type === 'directory');
    if (!child) {
      child = {
        name: seg,
        type: 'directory',
        children: [],
        size: 0,
        file_count: 0,
        dir_count: 0,
        path: current.path.replace(/\/+$/,'') + '/' + seg
      };
      current.children.push(child);
    }
    current = child;
  }
}

function insertFileNode(root, relPath, fileSize, content) {
  const parts = relPath.split('/');
  buildDirectoryNodes(root, parts.slice(0, -1));
  const fileName = parts[parts.length - 1];
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    current = current.children.find(c => c.name === seg && c.type === 'directory');
    if (!current) return;
  }
  current.children.push({
    name: fileName,
    type: 'file',
    size: fileSize,
    content: content,
    path: current.path + '/' + fileName
  });
}

function computeStats(node) {
  if (node.type === 'file') return;
  let fileCount = 0, dirCount = 0, size = 0;
  node.children.forEach(child => {
    if (child.type === 'directory') {
      computeStats(child);
      fileCount += child.file_count;
      dirCount += (1 + child.dir_count);
      size += child.size;
    } else {
      fileCount++;
      size += child.size;
    }
  });
  node.file_count = fileCount;
  node.dir_count = dirCount;
  node.size = size;
}

function buildTreeString(node, prefix='', isLast=true) {
  let tree = '';
  if (node.name && node.path !== '/') {
    const currentPrefix = isLast ? '└── ' : '├── ';
    const nameDisplay = (node.type==='directory') ? node.name+'/' : node.name;
    tree += prefix + currentPrefix + nameDisplay + '\n';
  }
  if (node.type === 'directory') {
    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    const kids = node.children.slice();
    kids.sort((a, b) => {
      const aName = a.name.toLowerCase(), bName = b.name.toLowerCase();
      if (aName==='readme.md') return -1;
      if (bName==='readme.md') return 1;
      const aFile = (a.type==='file');
      const bFile = (b.type==='file');
      if (aFile && !bFile) return -1;
      if (!aFile && bFile) return 1;
      return aName.localeCompare(bName);
    });
    for (let i = 0; i < kids.length; i++) {
      tree += buildTreeString(kids[i], newPrefix, i === kids.length - 1);
    }
  }
  return tree;
}

function collectFileContents(node, results, maxFileSize) {
  if (node.type==='file') {
    if (node.size <= maxFileSize && node.content) {
      results.push({ path: node.path, content: node.content });
    }
  } else {
    for (let child of node.children) {
      collectFileContents(child, results, maxFileSize);
    }
  }
}

function isLikelyTextFile(fname) {
  const textExtensions = [
    '.md','.txt','.py','.js','.html','.css','.json','.ipynb','.ts',
    '.jsx','.tsx','.yaml','.yml','.sh','.java','.c','.cpp','.go','.rs','.cbl','.dat','.cpy','.jcl','.psb', '.dbd'
  ];
  const lower = fname.toLowerCase();
  return textExtensions.some(ext=>lower.endsWith(ext));
}

function processNotebook(jsonString, path) {
  let notebook;
  try {
    notebook = JSON.parse(jsonString);
  } catch(e) {
    return `Error parsing notebook ${path}: ${e}`;
  }
  let cells = [];
  if (notebook.worksheets) {
    notebook.worksheets.forEach(ws => {
      if (ws.cells) cells = cells.concat(ws.cells);
    });
  } else if (notebook.cells) {
    cells = notebook.cells;
  }
  let result = '# Jupyter Notebook → pseudo Python\n';
  for (let c of cells) {
    if (!c.cell_type || !c.source) continue;
    let content = Array.isArray(c.source) ? c.source.join('') : c.source;
    if (c.cell_type==='code') {
      result += content + '\n';
      if (c.outputs && c.outputs.length>0) {
        result += `# Output:\n`;
        c.outputs.forEach(out=>{
          if (out.output_type==='stream') {
            let txt = Array.isArray(out.text)? out.text.join(''): out.text;
            result += '#   ' + txt.replace(/\n/g,'\n#   ') + '\n';
          } else if (['execute_result','display_data'].includes(out.output_type)) {
            let data = out.data && out.data['text/plain'];
            if (data) {
              let line = Array.isArray(data)? data.join(''): data;
              result += '#   ' + line.replace(/\n/g,'\n#   ') + '\n';
            }
          } else if (out.output_type==='error') {
            result += `#   Error: ${out.ename}: ${out.evalue}\n`;
          }
        });
      }
    } else if (c.cell_type==='markdown' || c.cell_type==='raw') {
      result += `"""\n${content}\n"""\n`;
    }
    result += '\n';
  }
  return result;
}

/*******************************************************************
 * Ingestion Results Modal
 *******************************************************************/
function openIngestionResultsModal() {
  document.getElementById('resultsDisplaySelect').value = 'summary';
  changeDisplayedIngestionText();
  const ingestionModal = new bootstrap.Modal(document.getElementById('ingestionResultsModal'));
  ingestionModal.show();
}

function changeDisplayedIngestionText() {
  const val = document.getElementById('resultsDisplaySelect').value;
  const displayArea = document.getElementById('resultsDisplayArea');
  if (val === 'summary') {
    displayArea.value = window.ingestResults.summary;
  } else if (val === 'directory') {
    displayArea.value = window.ingestResults.directory;
  } else {
    displayArea.value = window.ingestResults.files;
  }
}

function copyCurrentIngestionView() {
  const text = document.getElementById('resultsDisplayArea').value;
  navigator.clipboard.writeText(text).catch(()=>{});
}

function copyAllIngestionData() {
  const allData = [
    window.ingestResults.summary.trim(),
    window.ingestResults.directory.trim(),
    window.ingestResults.files.trim()
  ].join("\n\n");
  navigator.clipboard.writeText(allData).catch(()=>{});
}

/*******************************************************************
 * Utility: Patterns, file skipping
 *******************************************************************/
function normalizePattern(p) {
  p = p.replace(/^\/+/, '');
  if (p.endsWith('/')) p += '*';
  return p;
}

function shouldExclude(path, ignorePatterns) {
  const lowerPath = path.toLowerCase();
  for (let pat of ignorePatterns) {
    if (miniMatch(lowerPath, pat.toLowerCase())) return true;
  }
  return false;
}

function shouldInclude(path, includePatterns) {
  const lowerPath = path.toLowerCase();
  for (let pat of includePatterns) {
    if (miniMatch(lowerPath, pat.toLowerCase())) return true;
  }
  return false;
}

function miniMatch(path, pattern) {
  if (pattern.startsWith('*.')) {
    return path.endsWith(pattern.substring(1));
  }
  if (pattern.endsWith('/*')) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return path.includes(pattern);
}

/*******************************************************************
 * File size slider
 *******************************************************************/
function updateSliderLabel(value) {
  const bytes = sliderToBytes(value);
  document.getElementById('sliderLabel').textContent = humanFileSize(bytes);
  const slider = document.getElementById('fileSizeSlider');
  const max = slider.max;
  const percentage = (value / max) * 100;
  slider.style.setProperty('--range-progress', percentage + '%');
}

function sliderToBytes(position) {
  const maxp = 500;
  const minv = Math.log(1024); 
  const maxv = Math.log(100 * 1024 * 1024);
  const scale = Math.pow(position / maxp, 1.5);
  return Math.round(Math.exp(minv + (maxv - minv) * scale));
}

function humanFileSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  else if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

function cleanHTML(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  doc.body.querySelectorAll("[style]").forEach(el => el.removeAttribute("style"));
  return doc.body.innerHTML;
}

/*******************************************************************
 * Ask a Question on Code Functionality
 *******************************************************************/
document.getElementById('askQuestionBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  const questionText = document.getElementById('questionInput').value.trim();
  if (!questionText) {
    alert("Please enter a question.");
    return;
  }
  await askQuestionOnCode(window.ingestedCode, questionText);
});

async function askQuestionOnCode(code, question) {
  const questionAnswerOutput = document.getElementById('questionOutput');
  questionAnswerOutput.innerText = 'Generating answer...';
  try {
    const systemPrompt = "You are an expert on code functionality. Answer the question based on the given code snippet. Provide a concise and clear answer in plain text.";
    const userText = `Code:\n${code}\n\nQuestion:\n${question}\n\nProvide an answer based on the code.`;
    const answer = await callLLM(systemPrompt, userText);
    questionAnswerOutput.innerText = answer ? answer.replace(/```(\w+)?/g, '').trim() : "No response received.";
  } catch (error) {
    questionAnswerOutput.innerText = "Error generating answer: " + error.message;
  }
}

/*******************************************************************
 * Analyze Components & Function Calls
 *******************************************************************/
document.getElementById('analyzeComponentsBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  const analysisError = document.getElementById('analysisError');
  analysisError.classList.add('d-none');
  document.getElementById('loadingAnalysis').style.display = 'block';
  document.getElementById('entityList').innerHTML = '';
  document.getElementById('functionList').innerHTML = '';

  try {
    const analysis = await analyzeCode(window.ingestedCode);
    const entityList = document.getElementById('entityList');
    analysis.entities.forEach((entityName) => {
      const li = document.createElement('li');
      li.className = 'list-group-item clickable-item';
      li.innerHTML = `<i class="bi bi-box"></i> ${entityName}`;
      li.addEventListener('click', () => handleItemClick('entity', entityName));
      entityList.appendChild(li);
    });
    const functionList = document.getElementById('functionList');
    analysis.functions.forEach((funcName) => {
      const li = document.createElement('li');
      li.className = 'list-group-item clickable-item';
      li.innerHTML = `<i class="bi bi-arrow-right-circle"></i> ${funcName}`;
      li.addEventListener('click', () => handleItemClick('function', funcName));
      functionList.appendChild(li);
    });
  } catch (error) {
    analysisError.textContent = error.message;
    analysisError.classList.remove('d-none');
  } finally {
    document.getElementById('loadingAnalysis').style.display = 'none';
  }
});

async function handleItemClick(itemType, itemName) {
  try {
    document.getElementById('explanationModalLabel').innerText = `Loading ${itemType} details...`;
    document.getElementById('explanationModalBody').innerHTML = `
      <div class="text-center">
        <div class="spinner-border text-primary" role="status"></div>
        <p class="mt-2">Generating explanation...</p>
      </div>
    `;
    const explanationModal = new bootstrap.Modal(document.getElementById('explanationModal'));
    explanationModal.show();
    const code = window.ingestedCode;
    const explanationText = await getExplanation(itemName, itemType, code);
    document.getElementById('explanationModalLabel').innerText = itemName;
    document.getElementById('explanationModalBody').innerText = explanationText;
  } catch (err) {
    document.getElementById('explanationModalLabel').innerText = 'Error';
    document.getElementById('explanationModalBody').innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

async function getExplanation(itemName, itemType, code) {
  try {
    const systemPrompt = "You are an expert on COBOL code. Given a code snippet and the name of a particular entity or function call, provide a short plain-text description of what it is and how it is used.";
    const userText = `CODE:\n${code}\n\nITEM: ${itemName} (type: ${itemType})\nExplain usage/purpose.`;
    const explanation = await callLLM(systemPrompt, userText);
    if (!explanation) {
      throw new Error("No explanation returned from service.");
    }
    return explanation.trim();
  } catch (error) {
    throw new Error(`Failed to fetch explanation: ${error.message}`);
  }
}

/*******************************************************************
 * Generate BRD using DRY helper (for each section)
 *******************************************************************/
document.getElementById('generateBrdBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  await generateBRD(window.ingestedCode);
});

async function generateBRDSection(code, sectionTitle, instruction) {
  const systemPrompt = "You are a BRD generation expert. You MUST respond with ONLY valid HTML for the specified BRD section.";
  const userText = `
Reference only from this code:
---------------
${code}
---------------
Generate the "${sectionTitle}" section of a comprehensive BRD in HTML format.
${instruction}
Respond with valid HTML only.
  `;
  return await callLLM(systemPrompt, userText);
}

async function generateBRD(code) {
  const brdContent = document.getElementById('brdContent');
  brdContent.innerHTML = '';
  const sections = [
    { title: "Introduction", instruction: "Examine the code snippet and craft an Introduction section that describes the solution’s purpose, overall goals, and intended audience." },
    { title: "Business Objectives", instruction: "Analyze the code snippet to identify the business objectives. Align them with organizational goals and propose key performance indicators or success criteria." },
    { title: "Project Scope", instruction: "Review the code snippet to define the project scope, highlighting in-scope and out-of-scope elements, along with any constraints implied by the code." },
    { title: "Stakeholder Analysis", instruction: "Determine who the stakeholders are based on the code snippet's functionality. Describe their roles, responsibilities, and how they interact with the solution." },
    { title: "Functional Requirements", instruction: "Extract functional requirements from the code snippet. For each requirement, provide a concise description, priority, and acceptance criteria." },
    { title: "Non-Functional Requirements", instruction: "Identify non-functional requirements (like performance, security, or usability) suggested by the code snippet." },
    { title: "Use Cases / User Stories", instruction: "Derive use cases or user stories from the code snippet. Include user goals, main flows, and any alternative paths the code might support." },
    { title: "Assumptions and Dependencies", instruction: "Outline assumptions about environment or data, and dependencies on external systems, libraries, or services." },
    { title: "Constraints", instruction: "Highlight any technical, regulatory, or organizational constraints inferred from the code that shape the project." },
    { title: "Risks and Mitigations", instruction: "Identify potential risks associated with implementing the code and suggest possible mitigation or contingency strategies." },
    { title: "Acceptance Criteria and Approval", instruction: "Propose acceptance criteria for verifying the code’s functionality, and outline the sign-off or approval process once those criteria are met." }
  ];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const sectionDiv = document.createElement('section');
    sectionDiv.id = section.title.replace(/\s+/g, '-').toLowerCase();
    sectionDiv.innerHTML = `<em>Generating section ${i + 1} of ${sections.length}: ${section.title}</em>`;
    brdContent.appendChild(sectionDiv);
    try {
      const htmlSection = await generateBRDSection(code, section.title, section.instruction);
      sectionDiv.innerHTML = cleanHTML(htmlSection);
    } catch (err) {
      sectionDiv.innerHTML = `<p class="text-danger">Error generating ${section.title}: ${err.message}</p>`;
    }
  }
}

/*******************************************************************
 * Generate Test Cases
 *******************************************************************/
document.getElementById('generateTestCasesBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  await generateTestCases(window.ingestedCode);
});

async function generateTestCases(code) {
  const testCasesOutput = document.getElementById('testCasesOutput');
  testCasesOutput.value = 'Generating test cases...';
  try {
    const systemPrompt = "You are a test case generation expert. Respond with ONLY valid plain text containing test cases for the given code.";
    const userText = `Generate a set of test cases for the following code:\n\n${code}\n\nProvide a list of test cases in plain text format.`;
    const testCases = await callLLM(systemPrompt, userText);
    testCasesOutput.value = testCases ? testCases.replace(/```(\w+)?/g, '').trim() : "No response received";
  } catch (error) {
    testCasesOutput.value = "Error generating test cases: " + error.message;
  }
}

/*******************************************************************
 * Generate Pseudo Code
 *******************************************************************/
document.getElementById('generatePseudoCodeBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  await generatePseudoCode(window.ingestedCode);
});

async function generatePseudoCode(code) {
  const pseudoCodeOutput = document.getElementById('pseudoCodeOutput');
  pseudoCodeOutput.value = 'Generating pseudo code...';
  try {
    const systemPrompt = "You are a pseudo code generation expert. Respond with ONLY valid pseudo code for the given code.";
    const userText = `Generate pseudo code for the following code:\n\n${code}\n\nProvide a clear pseudo code representation.`;
    const pseudoCode = await callLLM(systemPrompt, userText);
    pseudoCodeOutput.value = pseudoCode ? pseudoCode.replace(/```(\w+)?/g, '').trim() : "No response received.";
  } catch (error) {
    pseudoCodeOutput.value = "Error generating pseudo code: " + error.message;
  }
}

/*******************************************************************
 * Analyze Database
 *******************************************************************/
document.getElementById('analyzeDatabaseBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  const dbanalysisLoading = document.getElementById('dbanalysisLoading');
  const dbanalysisError = document.getElementById('dbanalysisError');
  const dbanalysisResult = document.getElementById('dbanalysisResult');
  dbanalysisError.classList.add('d-none');
  dbanalysisResult.innerHTML = '<em>Working on database analysis...</em>';
  dbanalysisLoading.style.display = 'block';
  try {
    const systemPrompt = "You are an expert in COBOL and database systems. Analyze the given code and explain the database structure in detail. Format the output in HTML.";
    const analysisHTML = await callLLM(systemPrompt, window.ingestedCode);
    dbanalysisResult.innerHTML = cleanHTML(analysisHTML);
  } catch (error) {
    dbanalysisError.textContent = error.message;
    dbanalysisError.classList.remove('d-none');
  } finally {
    dbanalysisLoading.style.display = 'none';
  }
});

/*******************************************************************
 * Generate RDBMS Schema
 *******************************************************************/
document.getElementById('generateSchemaBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  const schemaLoading = document.getElementById('schemaLoading');
  const schemaError = document.getElementById('schemaError');
  const schemaResult = document.getElementById('schemaResult');
  schemaError.classList.add('d-none');
  schemaResult.innerHTML = '<em>Working on RDBMS schema...</em>';
  schemaLoading.style.display = 'block';
  try {
    const systemPrompt = "You are an expert in COBOL and modern databases. Convert the given COBOL database structure into a modern RDBMS schema. Format the output in HTML.";
    const schemaHTML = await callLLM(systemPrompt, window.ingestedCode);
    schemaResult.innerHTML = cleanHTML(schemaHTML);
  } catch (error) {
    schemaError.textContent = error.message;
    schemaError.classList.remove('d-none');
  } finally {
    schemaLoading.style.display = 'none';
  }
});

/*******************************************************************
 * Diagram Generation and Export
 *******************************************************************/
document.querySelectorAll('[data-diagram]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!window.ingestedCode) {
      alert("Please ingest code first.");
      return;
    }
    document.querySelectorAll('[data-diagram]').forEach((btn) => {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-primary');
    });
    button.classList.remove('btn-outline-primary');
    button.classList.add('btn-primary');
    const diagramError = document.getElementById('diagramError');
    diagramError.classList.add('d-none');
    document.getElementById('loadingDiagram').style.display = 'block';
    document.getElementById('diagramContainer').innerHTML = `
      <div class="text-center text-muted">
        <i class="bi bi-image fs-1"></i>
        <p>Loading diagram...</p>
      </div>`;
    document.getElementById('diagramActions').classList.add('d-none');
    const diagramType = button.dataset.diagram;
    try {
      const diagramSysPrompt = `You are an expert in COBOL code analysis and diagram generation. Generate a Mermaid ${diagramType} diagram.`;
      const diagramUserText = `
Follow these instructions:
${diagramType === 'sequence' ? "Generate a Mermaid sequence diagram" : diagramType === 'dfd' ? "Generate a Mermaid Data Flow diagram" : diagramType === 'class' ? "Generate a Mermaid class diagram" : "Generate a Mermaid state diagram"}
for the code below:
${window.ingestedCode}
Respond with ONLY valid Mermaid code (no extra text).
Ensure text labels are properly escaped.
      `;
      const mermaidCode = await callLLM(diagramSysPrompt, diagramUserText);
      if (!mermaidCode) { throw new Error("No diagram code returned from service."); }
      document.getElementById('diagramContainer').innerHTML = `<pre class="mb-0"><code>${mermaidCode}</code></pre>`;
      initializeMermaid();
      await renderMermaidDiagram(mermaidCode);
    } catch (error) {
      diagramError.textContent = error.message;
      diagramError.classList.remove('d-none');
    } finally {
      document.getElementById('loadingDiagram').style.display = 'none';
    }
  });
});

async function renderMermaidDiagram(mermaidCode) {
  try {
    const diagram = await mermaid.render('generatedDiagram', mermaidCode);
    const diagramContainer = document.getElementById('diagramContainer');
    diagramContainer.innerHTML = diagram.svg;
    window.latestDiagramSVG = diagram.svg;
    document.getElementById('diagramActions').classList.remove('d-none');
  } catch (error) {
    const diagramError = document.getElementById('diagramError');
    diagramError.textContent = "Failed to render diagram: " + error.message;
    diagramError.classList.remove('d-none');
  }
}

document.getElementById('openTabButton').addEventListener('click', function () {
  if (!window.latestDiagramSVG) {
    alert("No diagram available to open in a new tab!");
    return;
  }
  const blob = new Blob([window.latestDiagramSVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
});

document.getElementById('downloadSvgButton').addEventListener('click', function () {
  if (!window.latestDiagramSVG) {
    alert("No diagram available for download!");
    return;
  }
  const blob = new Blob([window.latestDiagramSVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = url;
  downloadLink.download = 'diagram.svg';
  downloadLink.click();
});

/*******************************************************************
 * Sample Files Modal Functionality
 *******************************************************************/
document.getElementById("samplebtn").addEventListener("click", async () => {
  try {
    const response = await fetch("manifest.json");
    if (!response.ok) {
      throw new Error("Failed to load manifest: " + response.status);
    }
    const manifest = await response.json();
    const samples = manifest.samples;
    const sampleFileList = document.getElementById("sampleFileList");
    sampleFileList.innerHTML = "";
    samples.forEach(fileName => {
      const li = document.createElement("li");
      li.className = "list-group-item list-group-item-action";
      li.textContent = fileName;
      li.style.cursor = "pointer";
      li.addEventListener("click", async () => {
        await ingestSampleFile(fileName);
        const modalEl = document.getElementById("sampleModal");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        modalInstance.hide();
      });
      sampleFileList.appendChild(li);
    });
    const modalEl = document.getElementById("sampleModal");
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  } catch (err) {
    console.error("Error loading sample manifest:", err);
  }
});

async function ingestSampleFile(fileName) {
  try {
    const fileUrl = "data/" + fileName;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error("Failed to fetch file: " + fileUrl);
    }
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: blob.type });
    const fileInput = document.getElementById("codeFile");
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    const event = new Event("change");
    fileInput.dispatchEvent(event);
  } catch (err) {
    console.error("Error ingesting sample file:", err);
  }
}

/*******************************************************************
 * Settings Modal Functionality
 *******************************************************************/
// Attach event listener to the Settings button to show the modal.
document.getElementById("settingsBtn").addEventListener("click", () => {
  const settingsModal = new bootstrap.Modal(document.getElementById("settingsModal"));
  settingsModal.show();
});

// Attach event listener to the Save Settings button to update globals.
document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  const providerSelect = document.getElementById("providerSelect");
  const modelSelect = document.getElementById("modelSelect");
  window.llmProvider = providerSelect.value;
  window.llmModel = modelSelect.value;
  alert("Settings saved: Provider = " + window.llmProvider + ", Model = " + window.llmModel);
});

/*******************************************************************
 * Fixed Sidebar Navigation – Show only selected section.
 *******************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#main-content section').forEach(section => {
    section.style.display = (section.id === 'home') ? 'block' : 'none';
    const slider = document.getElementById('fileSizeSlider');
    updateSliderLabel(slider.value);
  });
  document.querySelectorAll('#sidebar a').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const targetId = link.getAttribute('href')?.substring(1);
      if (!targetId) return;
      document.querySelectorAll('#main-content section').forEach(section => {
        section.style.display = 'none';
      });
      const targetSection = document.getElementById(targetId);
      if (targetSection) {
        targetSection.style.display = 'block';
        targetSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});

/*******************************************************************
 * Analyze Code – Return JSON with entities & functions
 *******************************************************************/
async function analyzeCode(code) {
  try {
    const systemPrompt = "You are a code analysis expert. Respond with ONLY valid JSON containing 'entities' and 'functions' arrays.";
    const userText = `Extract ALL entities (classes, interfaces, structs) and ALL function/API calls from this code.
Respond with ONLY this JSON structure:
{
  "entities": ["entity1", "entity2", ...],
  "functions": ["function1()", "function2()", ...]
}
Code to analyze:
${code}`;
    const responseContent = await callLLM(systemPrompt, userText);
    if (!responseContent) {
      throw new Error("No analysis response received.");
    }
    const cleanedText = responseContent.replace(/```json/g, "").replace(/```/g, "").trim();
    const analysis = JSON.parse(cleanedText);
    if (!analysis.entities || !analysis.functions) {
      throw new Error("Invalid analysis format from LLM.");
    }
    return analysis;
  } catch (error) {
    throw new Error(`Analysis failed: ${error.message}`);
  }
}
