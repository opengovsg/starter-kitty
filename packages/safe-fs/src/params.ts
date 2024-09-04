interface ParamsToSanitize {
  [key: string]: number[]
}

const PARAMS_TO_SANITIZE: ParamsToSanitize = {
  access: [0], // path
  appendFile: [0], // path
  chmod: [0], // path
  chown: [0], // path
  copyFile: [0, 1], // src, dest
  cp: [0, 1], // src, dest
  glob: [0], // pattern
  lchmod: [0], // path
  lchown: [0], // path
  lutimes: [0], // path
  link: [0, 1], // existingPath, newPath
  lstat: [0], // path
  mkdir: [0], // path
  mkdtemp: [0], // prefix
  open: [0], // path
  opendir: [0], // path
  readdir: [0], // path
  readFile: [0], // path
  readlink: [0], // path
  realpath: [0], // path
  rename: [0, 1], // oldPath, newPath
  rmdir: [0], // path
  rm: [0], // path
  stat: [0], // path
  statfs: [0], // path
  symlink: [0, 1], // target, path
  truncate: [0], // path
  unlink: [0], // path
  utimes: [0], // path
  writeFile: [0], // path
  accessSync: [0], // path
  appendFileSync: [0], // path
  chmodSync: [0], // path
  chownSync: [0], // path
  copyFileSync: [0, 1], // src, dest
  cpSync: [0, 1], // src, dest
  globSync: [0], // pattern
  lchmodSync: [0], // path
  lchownSync: [0], // path
  lutimesSync: [0], // path
  linkSync: [0, 1], // existingPath, newPath
  lstatSync: [0], // path
  mkdirSync: [0], // path
  mkdtempSync: [0], // prefix
  openSync: [0], // path
  opendirSync: [0], // path
  readdirSync: [0], // path
  readFileSync: [0], // path
  readlinkSync: [0], // path
  realpathSync: [0], // path
  renameSync: [0, 1], // oldPath, newPath
  rmdirSync: [0], // path
  rmSync: [0], // path
  statSync: [0], // path
  statfsSync: [0], // path
  symlinkSync: [0, 1], // target, path
  truncateSync: [0], // path
  unlinkSync: [0], // path
  utimesSync: [0], // path
  writeFileSync: [0], // path
}

export default PARAMS_TO_SANITIZE
