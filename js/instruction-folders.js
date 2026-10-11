/* Folder discovery is independent of the final document naming convention. */
const HubInstructionFolders = (() => {
  const visible = name => !name.startsWith('.') && !['thumbs.db', 'desktop.ini'].includes(name.toLowerCase());

  function parseName(folderName) {
    const name = String(folderName).trim();
    const suffix = name.match(/^(.*?)\s+-\s+([\p{L}\p{N}._-]*\d[\p{L}\p{N}._-]*)$/u);
    if (suffix) return {name: suffix[1].trim(), number: suffix[2]};
    const labeled = name.match(/^(?:профил|profile)\s+([\p{L}\p{N}._-]*\d[\p{L}\p{N}._-]*)$/iu);
    if (labeled) return {name, number: labeled[1]};
    // Keep letters and leading zeroes in compact profile identifiers.
    const number = /^[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*$/u.test(name) && /\d/.test(name) ? name : '';
    return {name, number};
  }

  function existingKey(index, folderName) {
    return Object.keys(index).find(key => index[key].folderName === folderName);
  }

  function allocateKey(index, number) {
    let key = number, suffix = 2;
    while (Object.hasOwn(index, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) key = number + '~' + suffix++;
    return key;
  }

  function destinationPath(candidate) {
    const client = String(candidate.client || '').trim();
    return candidate.selectedProfile && client ? client + '/' + candidate.originalPath : candidate.originalPath;
  }

  async function inspect(handle) {
    const files = [], directories = [];
    let instructionText = '';
    for await (const [name, child] of handle.entries()) {
      if (!visible(name)) continue;
      if (child.kind === 'directory') directories.push([name, child]);
      else if (name === 'instruction.txt') instructionText = await (await child.getFile()).text();
      else files.push(name);
    }
    files.sort((a, b) => a.localeCompare(b));
    directories.sort(([a], [b]) => a.localeCompare(b));
    return {files, directories, instructionText};
  }

  async function collectAttachments(handle, direct = null) {
    const content = direct || await inspect(handle);
    const files = [...content.files];
    for (const [name, child] of content.directories) {
      const nested = await collectAttachments(child);
      if (nested.instructionText) files.push(name + '/instruction.txt');
      files.push(...nested.files.map(file => name + '/' + file));
    }
    return {files, instructionText: content.instructionText};
  }

  async function scan(handle, {copyNeeded = false, skipExisting = false, index = {}, layout = 'auto'} = {}) {
    const candidates = [];
    let skippedEmpty = 0;
    const root = await inspect(handle);
    let resolvedLayout = layout;
    if (layout === 'auto') {
      resolvedLayout = !copyNeeded || handle.name.toLowerCase() === 'profiles' ? 'collection'
        : parseName(handle.name).number ? 'profile'
        : copyNeeded && root.directories.length && root.directories.every(([name]) => parseName(name).number) ? 'client' : 'collection';
    }
    const basePath = copyNeeded && ['client', 'profile'].includes(resolvedLayout) ? [handle.name] : [];

    function add(folder, parts, client, content) {
      if (!content.files.length && !content.instructionText.trim()) { skippedEmpty++; return; }
      const originalPath = (parts.length ? parts : [handle.name]).join('/');
      if (skipExisting && existingKey(index, originalPath) !== undefined) return;
      const parsed = parseName(folder.name);
      candidates.push({client, originalPath, sourceHandle: folder, name: parsed.name, number: parsed.number,
        category: '', instructionText: content.instructionText, files: content.files, copyNeeded,
        selectedProfile: copyNeeded && resolvedLayout === 'profile'});
    }

    async function walk(folder, parts, client, content = null, forceProfile = false) {
      const direct = content || await inspect(folder);
      if (forceProfile || parseName(folder.name).number) {
        add(folder, parts, client, await collectAttachments(folder, direct));
        return;
      }
      if (direct.files.length || direct.instructionText.trim()) add(folder, parts, client, direct);
      else if (!direct.directories.length) skippedEmpty++;
      for (const [name, child] of direct.directories) await walk(child, [...parts, name], client);
    }

    if (resolvedLayout === 'profile') {
      await walk(handle, basePath, '', root, true);
    } else if (resolvedLayout === 'client') {
      // The selected client folder is retained when copying into the project.
      if (root.files.length || root.instructionText.trim()) add(handle, basePath, handle.name, root);
      for (const [name, child] of root.directories) await walk(child, [...basePath, name], handle.name);
    } else {
      if (copyNeeded && (root.files.length || root.instructionText.trim())) add(handle, [], '', root);
      for (const [name, child] of root.directories) {
        if (resolvedLayout === 'clients') {
          const direct = await inspect(child);
          if (direct.files.length || direct.instructionText.trim()) add(child, [name], name, direct);
          for (const [profileName, profile] of direct.directories) await walk(profile, [name, profileName], name);
          if (!direct.files.length && !direct.instructionText.trim() && !direct.directories.length) skippedEmpty++;
        } else await walk(child, [name], parseName(name).number ? '' : name);
      }
    }
    return {candidates, skippedEmpty};
  }

  async function fileHandle(folder, relativePath, create = false) {
    const parts = String(relativePath).split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('Invalid attachment path');
    const name = parts.pop();
    for (const part of parts) folder = await folder.getDirectoryHandle(part, {create});
    return folder.getFileHandle(name, {create});
  }

  return {parseName, existingKey, allocateKey, destinationPath, scan, fileHandle};
})();
