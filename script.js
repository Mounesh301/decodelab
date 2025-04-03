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
/*************************************************************
 * Refactored File Ingestion using processFiles()
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
      for (let p of userPatterns) {
        ignorePatterns.delete(p);
      }
    } else if (patternType === 'exclude' && userPatterns.size > 0) {
      for (let p of userPatterns) {
        ignorePatterns.add(p);
      }
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
 * Helper: processZipFile using JSZip
 *******************************************************************/
async function processZipFile(zipFile, rootNode, ignorePatterns, includePatterns, maxFileSize) {
  const arrayBuffer = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // For each entry in the zip
  const filesList = Object.keys(zip.files);
  for (let relPath of filesList) {
    const zipEntry = zip.files[relPath];
    if (zipEntry.dir) {
      buildDirectoryNodes(rootNode, relPath.split('/'));
      continue;
    }

    // Check patterns / size
    if (shouldExclude(relPath, ignorePatterns)) continue;
    if (includePatterns && !shouldInclude(relPath, includePatterns)) continue;

    const fileSize = zipEntry._data?.uncompressedSize || 0;
    if (fileSize > maxFileSize) continue;

    let content = '[Non-text file]';
    if (isLikelyTextFile(relPath) && fileSize > 0) {
      const fileData = await zipEntry.async("string").catch(() => null);
      if (fileData) {
        if (relPath.endsWith('.ipynb')) {
          content = processNotebook(fileData, relPath);
        } else {
          content = fileData;
        }
      }
    }
    insertFileNode(rootNode, relPath, fileSize, content);
  }
}

/*******************************************************************
 * Ingestion results modal
 *******************************************************************/
function openIngestionResultsModal() {
  // default display is "summary"
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

// Basic matching (just enough for star patterns like *.md, or folder/*, or substring)
function miniMatch(path, pattern) {
  if (pattern.startsWith('*.')) {
    // e.g. *.md → must end with .md
    return path.endsWith(pattern.substring(1));
  }
  if (pattern.endsWith('/*')) {
    // e.g. docs/* → path starts with "docs/"
    return path.startsWith(pattern.slice(0, -1));
  }
  // fallback: substring
  return path.includes(pattern);
}

/*******************************************************************
 * Utility: building directory structure
 *******************************************************************/
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
    // Sort them so that readme.md first, then files, then dirs
    kids.sort((a,b) => {
      const aName = a.name.toLowerCase(), bName = b.name.toLowerCase();
      if (aName==='readme.md') return -1;
      if (bName==='readme.md') return 1;
      const aFile = (a.type==='file');
      const bFile = (b.type==='file');
      if (aFile && !bFile) return -1;
      if (!aFile && bFile) return 1;
      return aName.localeCompare(bName);
    });
    for (let i=0; i<kids.length; i++) {
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

// Minimal Jupyter notebook → pseudo Python
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

// =============================================================
// CHANGED: New Samples Button and Directory Listing via fetch
// =============================================================

// ===============================
// NEW: Sample Files Modal Functionality
// ===============================

// Event listener for the "Upload Samples" button
document.getElementById("samplebtn").addEventListener("click", async () => {
  try {
    // Fetch the manifest.json that contains the sample file names
    const response = await fetch("manifest.json");
    if (!response.ok) {
      throw new Error("Failed to load manifest: " + response.status);
    }
    const manifest = await response.json();
    const samples = manifest.samples; // Expects an array of file names, e.g., ["cobol-ims-banking.zip", "sample2.txt"]

    // Get the <ul> element that will hold the file list
    const sampleFileList = document.getElementById("sampleFileList");
    sampleFileList.innerHTML = ""; // Clear any existing items

    // Populate the list with each sample file name
    samples.forEach(fileName => {
      const li = document.createElement("li");
      li.className = "list-group-item list-group-item-action";
      li.textContent = fileName;
      li.style.cursor = "pointer";
      // When a file is clicked, fetch and ingest it
      li.addEventListener("click", async () => {
        await ingestSampleFile(fileName);
        // Close the modal after selection
        const modalEl = document.getElementById("sampleModal");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        modalInstance.hide();
      });
      sampleFileList.appendChild(li);
    });

    // Show the modal
    const modalEl = document.getElementById("sampleModal");
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  } catch (err) {
    console.error("Error loading sample manifest:", err);
  }
});

/**
 * Fetches the selected sample file from the data folder,
 * converts it to a File object, assigns it to the file input,
 * and triggers the ingestion process.
 */
async function ingestSampleFile(fileName) {
  try {
    const fileUrl = "data/" + fileName; // Construct the full URL to the sample file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error("Failed to fetch file: " + fileUrl);
    }
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: blob.type });
    
    // Assign the file to the file input element using a DataTransfer object
    const fileInput = document.getElementById("codeFile");
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    
    // Dispatch a change event so that your existing ingestion logic is triggered
    const event = new Event("change");
    fileInput.dispatchEvent(event);
  } catch (err) {
    console.error("Error ingesting sample file:", err);
  }
}
/*******************************************************************
 * File size slider
 *******************************************************************/
function updateSliderLabel(value) {
  const bytes = sliderToBytes(value);
  document.getElementById('sliderLabel').textContent = humanFileSize(bytes);
  // Update the slider progress via CSS variable
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

/*************************************************************
 * Ask a Question on Code Functionality
 *************************************************************/
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
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are an expert on code functionality. Answer the question based on the given code snippet. Provide a concise and clear answer in plain text."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Code:
${code}

Question:
${question}

Provide an answer to the question based on the code.`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) {
      throw new Error("Invalid response from question service");
    }

    questionAnswerOutput.innerText = answer.replace(/```(\w+)?/g, '').trim();
  } catch (error) {
    questionAnswerOutput.innerText = "Error generating answer: " + error.message;
  }
}

/*************************************************************
 * Analyze Components & Function Calls
 *************************************************************/
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
    // Display entities
    const entityList = document.getElementById('entityList');
    analysis.entities.forEach((entityName) => {
      const li = document.createElement('li');
      li.className = 'list-group-item clickable-item';
      li.innerHTML = `<i class="bi bi-box"></i> ${entityName}`;
      // Make the item clickable (show the modal with LLM explanation)
      li.addEventListener('click', () => handleItemClick('entity', entityName));
      entityList.appendChild(li);
    });

    // Display function/API calls
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

/*************************************************************
 * handleItemClick - triggered when an entity or function is clicked.
 *************************************************************/
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
    document.getElementById('explanationModalBody').innerHTML = `
      <div class="alert alert-danger">${err.message}</div>
    `;
  }
}

async function getExplanation(itemName, itemType, code) {
  try {
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are an expert on COBOL code. Given a code snippet and the name of a particular entity or function call, provide a short plain-text description of what it is, and how it is used in the code."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `CODE:
${code}

ITEM: ${itemName} (type: ${itemType})
Explain usage/purpose.`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    const explanation = data?.choices?.[0]?.message?.content;
    if (!explanation) {
      throw new Error("No explanation returned from service.");
    }
    return explanation.trim();
  } catch (error) {
    throw new Error(`Failed to fetch explanation: ${error.message}`);
  }
}

/*************************************************************
 * Generate BRD
 *************************************************************/
document.getElementById('generateBrdBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  await generateBRD(window.ingestedCode);
});

async function generateBRD(code) {
  const brdLoading = document.getElementById('brdLoading');
  const brdError = document.getElementById('brdError');
  const brdContent = document.getElementById('brdContent');

  brdLoading.style.display = 'block';
  brdError.classList.add('d-none');
  brdContent.innerHTML = '<em>Generating BRD sections...</em>';

  const sections = [
    {
      title: "Introduction",
      instruction: "Examine the code snippet and craft an Introduction section that describes the solution’s purpose, overall goals, and intended audience."
    },
    {
      title: "Business Objectives",
      instruction: "Analyze the code snippet to identify the business objectives. Align them with organizational goals and propose key performance indicators or success criteria."
    },
    {
      title: "Project Scope",
      instruction: "Review the code snippet to define the project scope, highlighting in-scope and out-of-scope elements, along with any constraints implied by the code."
    },
    {
      title: "Stakeholder Analysis",
      instruction: "Determine who the stakeholders are based on the code snippet's functionality. Describe their roles, responsibilities, and how they interact with the solution."
    },
    {
      title: "Functional Requirements",
      instruction: "Extract functional requirements from the code snippet. For each requirement, provide a concise description, priority, and acceptance criteria."
    },
    {
      title: "Non-Functional Requirements",
      instruction: "Identify non-functional requirements suggested by the code snippet (such as performance, security, or usability) and list them appropriately."
    },
    {
      title: "Use Cases / User Stories",
      instruction: "Derive use cases or user stories from the code snippet. Include user goals, main flows, and any alternative paths the code might support."
    },
    {
      title: "Assumptions and Dependencies",
      instruction: "Outline any assumptions (for example, regarding environment or data) and dependencies on external systems, libraries, or services based on the code."
    },
    {
      title: "Constraints",
      instruction: "Highlight any technical, regulatory, or organizational constraints that can be inferred from the code and that may limit or shape the project."
    },
    {
      title: "Risks and Mitigations",
      instruction: "Identify potential risks associated with implementing the code and suggest possible mitigation or contingency strategies."
    },
    {
      title: "Acceptance Criteria and Approval",
      instruction: "Propose acceptance criteria for verifying the code’s functionality, and outline the sign-off or approval process required once those criteria are met."
    }
  ];

  let finalBRDHTML = '';

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    brdContent.innerHTML = `<em>Generating section ${i + 1} of ${sections.length}: ${section.title}</em>`;
    try {
      const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {  "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          model: "o3-mini-2025-01-31",
          messages: [
            {
              role: "system",
              content:
                "You are a BRD generation expert. You MUST respond with ONLY valid HTML for the specified BRD section."
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `
  Reference only from this code:
  ---------------
  ${code}
  ---------------
  Generate the "${section.title}" section of a comprehensive BRD in HTML format.
  ${section.instruction}
  Respond with valid HTML only.`
                }
              ]
            }
          ]
        })
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message);
      }

      const htmlSection = data?.choices?.[0]?.message?.content;
      if (!htmlSection) {
        throw new Error(`Invalid response for section "${section.title}"`);
      }
      const cleanedHtmlSection = htmlSection.replace(/```(\w+)?/g, '').trim();
      finalBRDHTML += `<section id="${section.title.replace(/\s+/g, '-').toLowerCase()}">
        ${cleanedHtmlSection}
      </section>`;
    } catch (err) {
      finalBRDHTML += `<section id="${section.title.replace(/\s+/g, '-').toLowerCase()}">
        <h5>${section.title}</h5>
        <p class="text-danger">Error generating this section: ${err.message}</p>
      </section>`;
    }
  }
  brdContent.innerHTML = finalBRDHTML;
  brdLoading.style.display = 'none';
}

/*************************************************************
 * Generate Test Cases
 *************************************************************/
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
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are a test case generation expert. Respond with ONLY valid plain text containing test cases for the given code."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Generate a set of test cases for the following code:

${code}

Provide a list of test cases in plain text format.`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const testCases = data?.choices?.[0]?.message?.content;
    if (!testCases) {
      throw new Error("No test cases returned from service.");
    }

    testCasesOutput.value = testCases.replace(/```(\w+)?/g, '').trim();
  } catch (error) {
    testCasesOutput.value = "Error generating test cases: " + error.message;
  }
}

/*************************************************************
 * Generate Pseudo Code
 *************************************************************/
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
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are a pseudo code generation expert. Respond with ONLY valid pseudo code for the given code."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Generate pseudo code for the following code:

${code}

Provide a clear pseudo code representation.`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    const pseudoCode = data?.choices?.[0]?.message?.content;
    if (!pseudoCode) {
      throw new Error("No pseudo code returned from service.");
    }
    pseudoCodeOutput.value = pseudoCode.replace(/```(\w+)?/g, '').trim();
  } catch (error) {
    pseudoCodeOutput.value = "Error generating pseudo code: " + error.message;
  }
}

/*************************************************************
 * Analyze Database
 *************************************************************/
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
    const analysisHTML = await analyzeDatabase(window.ingestedCode);
    dbanalysisResult.innerHTML = analysisHTML;
  } catch (error) {
    dbanalysisError.textContent = error.message;
    dbanalysisError.classList.remove('d-none');
  } finally {
    dbanalysisLoading.style.display = 'none';
  }
});

async function analyzeDatabase(code) {
  try {
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are an expert in COBOL and database systems. Analyze the given code and explain the database structure in detail. Format the output in HTML."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: code
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const analysis = data?.choices?.[0]?.message?.content;
    if (!analysis) {
      throw new Error("No analysis content returned.");
    }
    return analysis;
  } catch (err) {
    throw new Error(`Database analysis failed: ${err.message}`);
  }
}

/*************************************************************
 * Generate RDBMS Schema
 *************************************************************/
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
    const schemaHTML = await generateRdbmsSchema(window.ingestedCode);
    schemaResult.innerHTML = schemaHTML;
  } catch (error) {
    schemaError.textContent = error.message;
    schemaError.classList.remove('d-none');
  } finally {
    schemaLoading.style.display = 'none';
  }
});

async function generateRdbmsSchema(code) {
  try {
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are an expert in COBOL and modern databases. Convert the given COBOL database structure into a modern RDBMS schema. Format the output in HTML."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: code
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const schema = data?.choices?.[0]?.message?.content;
    if (!schema) {
      throw new Error("No schema content returned.");
    }
    return schema;
  } catch (err) {
    throw new Error(`Schema generation failed: ${err.message}`);
  }
}

/*************************************************************
 * Diagram Buttons – using ingested code
 *************************************************************/
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
      const mermaidCode = await generateDiagram(window.ingestedCode, diagramType);
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

async function generateDiagram(code, type) {
  try {
    const diagramNames = {
      sequence: "Sequence Flow",
      dfd: "Data Flow",
      class: "Class",
      state: "State"
    };

    const diagramInst = {
      sequence: `
Analyze the COBOL code to identify calls or interactions between programs, subroutines, or external services.
Generate a Mermaid sequence diagram illustrating the order of these interactions.
Use actors (or participants) that represent each program or module from the COBOL code.
      `,
      dfd: `
Generate a Mermaid Data Flow diagram showing data sources, destinations, and any transformations.
      `,
      class: `
Examine the COBOL code to identify data structures, copybooks, or record definitions that could be treated like classes or entities.
Generate a Mermaid class diagram that outlines these structures and their relationships.
      `,
      state: `
Generate a Mermaid state diagram that shows possible states and transitions (e.g., from initialization to processing, error handling, completion, etc.).
      `
    };

    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content: `You are an expert in COBOL code analysis and diagram generation. Your task is to analyze the following COBOL code. Generate a Memaid ${diagramNames[type]} diagram code.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `
                Use the instructions below for accuracy:
${diagramInst[type]}                
                Generate a Mermaid ${diagramNames[type]} based on this code.
                Code:

${code}
`
              },
              {
                type: "text",
                text: `
Respond with ONLY valid Mermaid code (no disclaimers or explanations).
Output only valid Mermaid code (no markdown fences or additional text).
Ensure that text labels are properly escaped (for example, avoid unescaped double quotes or use single quotes if needed).
Validate the syntax against the Mermaid specification before output.
`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const mermaidCode = data?.choices?.[0]?.message?.content;
    if (!mermaidCode) {
      throw new Error("No diagram code returned from service.");
    }

    return mermaidCode
      .replace(/```mermaid/g, "")
      .replace(/```/g, "")
      .trim();
  } catch (error) {
    throw new Error(`Diagram generation failed: As there is no appropriate depiction`);
  }
}

async function renderMermaidDiagram(mermaidCode) {
  try {
    const diagram = await mermaid.render('generatedDiagram', mermaidCode);
    const diagramContainer = document.getElementById('diagramContainer');
    diagramContainer.innerHTML = diagram.svg;

    // Save the rendered SVG globally so the buttons can access it
    window.latestDiagramSVG = diagram.svg;
    document.getElementById('diagramActions').classList.remove('d-none');
  } catch (error) {
    const diagramError = document.getElementById('diagramError');
    diagramError.textContent = "Failed to render diagram: " + error.message;
    diagramError.classList.remove('d-none');
  }
}

/* ----- OPEN IN NEW TAB (SVG) ----- */
document.getElementById('openTabButton').addEventListener('click', function () {
  if (!window.latestDiagramSVG) {
    alert("No diagram available to open in a new tab!");
    return;
  }
  const blob = new Blob([window.latestDiagramSVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
});

/* ----- DOWNLOAD AS SVG ----- */
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

/*************************************************************
 * NEW: Generate User Guide
 *************************************************************/
document.getElementById('generateUserGuideBtn').addEventListener('click', async () => {
  if (!window.ingestedCode) {
    alert("Please ingest code first.");
    return;
  }
  await generateUserGuide(window.ingestedCode);
});

async function generateUserGuide(code) {
  const userGuideLoading = document.getElementById('userGuideLoading');
  const userGuideError = document.getElementById('userGuideError');
  const userGuideContent = document.getElementById('userGuideContent');

  userGuideError.classList.add('d-none');
  userGuideContent.innerHTML = '<em>Generating user guide...</em>';
  userGuideLoading.style.display = 'block';

  try {
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are a user guide generation expert. Based on the following code snippet, produce a thorough user guide in HTML. Include relevant sections and instructions for end users. No disclaimers."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: code
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const guide = data?.choices?.[0]?.message?.content;
    if (!guide) {
      throw new Error("No user guide content returned.");
    }
    userGuideContent.innerHTML = guide;
  } catch (err) {
    userGuideError.textContent = err.message;
    userGuideError.classList.remove('d-none');
  } finally {
    userGuideLoading.style.display = 'none';
  }
}

/*************************************************************
 * Copy Buttons
 *************************************************************/
document.getElementById('copyAnswerBtn').addEventListener('click', () => {
  const answerContent = document.getElementById('questionOutput').innerText;
  navigator.clipboard.writeText(answerContent)
    .then(() => alert('Answer copied!'))
    .catch(() => alert('Failed to copy answer.'));
});

document.getElementById('copyBrdBtn').addEventListener('click', () => {
  const brdContent = document.getElementById('brdContent').innerText;
  navigator.clipboard.writeText(brdContent)
    .then(() => alert('BRD content copied!'))
    .catch(() => alert('Failed to copy BRD content.'));
});

document.getElementById('copyTestCasesBtn').addEventListener('click', () => {
  const testCasesContent = document.getElementById('testCasesOutput').value;
  navigator.clipboard.writeText(testCasesContent)
    .then(() => alert('Test cases copied!'))
    .catch(() => alert('Failed to copy test cases.'));
});

document.getElementById('copyPseudoCodeBtn').addEventListener('click', () => {
  const pseudoContent = document.getElementById('pseudoCodeOutput').value;
  navigator.clipboard.writeText(pseudoContent)
    .then(() => alert('Pseudo code copied!'))
    .catch(() => alert('Failed to copy pseudo code.'));
});

document.getElementById('copyUserGuideBtn').addEventListener('click', () => {
  const userGuideText = document.getElementById('userGuideContent').innerText;
  navigator.clipboard.writeText(userGuideText)
    .then(() => alert('User Guide copied!'))
    .catch(() => alert('Failed to copy User Guide.'));
});

/*************************************************************
 * Fixed Sidebar Navigation – Show only selected section.
 *************************************************************/
document.addEventListener('DOMContentLoaded', () => {
  // Initially show only the "Home" section.
  document.querySelectorAll('#main-content section').forEach(section => {
    section.style.display = (section.id === 'home') ? 'block' : 'none';
    const slider = document.getElementById('fileSizeSlider');
    updateSliderLabel(slider.value);
  });

  // Attach click event listeners to each sidebar link
  document.querySelectorAll('#sidebar a').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const targetId = link.getAttribute('href').substring(1);

      // Hide all sections
      document.querySelectorAll('#main-content section').forEach(section => {
        section.style.display = 'none';
      });

      // Show only the selected section
      const targetSection = document.getElementById(targetId);
      if (targetSection) {
        targetSection.style.display = 'block';
        targetSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});

/*************************************************************
 * Analyze Code
 *************************************************************/
async function analyzeCode(code) {
  try {
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {  "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "o3-mini-2025-01-31",
        messages: [
          {
            role: "system",
            content:
              "You are a code analysis expert. You MUST respond with ONLY valid JSON containing 'entities' and 'functions' arrays."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract ALL entities (classes, interfaces, structs) and ALL function/API calls from this code. Respond with ONLY this JSON structure:
{
  "entities": ["entity1", "entity2", ...],
  "functions": ["function1()", "function2()", ...]
}

Code to analyze:
${code}`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const responseContent = data?.choices?.[0]?.message?.content;
    if (!responseContent) {
      throw new Error("Invalid response from analysis service");
    }

    const cleanedText = responseContent
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const analysis = JSON.parse(cleanedText);
    if (!analysis.entities || !analysis.functions) {
      throw new Error("Invalid analysis format");
    }
    return analysis;
  } catch (error) {
    throw new Error(`Analysis failed: ${error.message}`);
  }
}
