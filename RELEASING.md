# 发布 CodeGraph

面向维护者的发布流程。一次发布由五部分组成：

**版本号 bump → 测试 → commit / push / CI → npm publish → tag / GitHub Release**

> 推荐先确认 npm publish 成功，再打 tag 和创建 Release，避免 tag 指向一个没有发出去的版本。

## 1. 确定版本号

- **patch**：只修 bug，例如 `0.4.0 → 0.4.1`
- **minor**：新增功能，例如 `0.4.0 → 0.5.0`
- **major**：不兼容变更

版本号必须同时出现在下面六个位置，保持完全一致：

| 文件 | 位置 |
|---|---|
| `package.json` | `version` |
| `package-lock.json` | 根 package 的 `version` |
| `.claude-plugin/plugin.json` | `version` |
| `dsh/index.js` | `const VERSION` |
| `dsh/lib/build.js` | `GENERATOR.version` |
| `skills/codegraph/scripts/build-walkthrough.mjs` | `const VERSION` |

这些值会进入 npm 包、DSH 卡片和 CodeWalkthrough 生成器；漏改会导致版本信息不一致。

## 2. 前置检查

```bash
git switch main
git pull --ff-only
git status --short
```

工作区必须干净。确认当前 Node 版本 >= 18：

```bash
node --version
```

发布账号需要是 `longbowzz`，并且拥有 `@longbowzz` scope 的发布权限。

## 3. 测试

```bash
npm test
```

当前测试覆盖 parser、validator、diff 状态、HTML 构建和 CLI。

如果这次改动涉及 vendored Mermaid，先重建 bundle：

```bash
npm run build:mermaid
npm test
```

## 4. 检查 npm 包内容

```bash
npm pack --dry-run
```

确认：

- `version` 是新版本
- 文件数合理（当前约 56 个）
- `dsh/`、`skills/codegraph/`、`skills/codegraph/examples/class-diagram/` 都在
- 没有误带 `.codegraph/`、临时文件或测试产物

注意：`package.json` 的 `files` 只包含 `dsh` 和 `skills/codegraph`，`images/` 不会进入 npm 包。因此 README 里的图片在 npm 页面可能不显示；GitHub 页面正常。这是既有行为。

## 5. commit、push、CI

```bash
git add package.json package-lock.json .claude-plugin/plugin.json \
  dsh/index.js dsh/lib/build.js skills/codegraph/scripts/build-walkthrough.mjs
git commit -m "chore: release x.y.z"
git push origin main
```

等待 GitHub Actions 的 **Script tests** 通过：

```bash
gh run list --workflow script-tests.yml --limit 1
gh run watch <run-id> --exit-status
```

CI 未通过不要发布。

## 6. npm 登录

npm token 过期时，`npm whoami` 会返回 401，`PUT` 甚至可能被报成 404。

```bash
npm login --registry https://registry.npmjs.org
npm whoami
# 必须输出 longbowzz
```

如果 `~/.npm` 里有 root 权限文件，普通 npm 命令可能报 `EPERM`。一次性修复：

```bash
sudo chown -R "$(id -u):$(id -g)" ~/.npm
```

或者给本次命令用临时 cache：

```bash
npm login --cache /tmp/npmcache-publish
npm publish --access public --cache /tmp/npmcache-publish
```

## 7. 发布到 npm

```bash
npm publish --access public
```

`package.json` 已有 `publishConfig.access: "public"`，所以 `npm publish` 也可以；保留 `--access public` 更直观。

如果 npm 要求一次性验证码：

```bash
npm publish --access public --otp=123456
```

如果报 `EOTP`，重新取当前 6 位验证码，不要复用旧码。

## 8. 验证 npm

```bash
npm view @longbowzz/dsh-codegraph version dist-tags
npm view @longbowzz/dsh-codegraph@x.y.z version
```

刚发布时 registry 可能有几十秒到几分钟延迟；`0.4.0` 当时约 45 秒后才可访问。不要因为第一次 404 就重复 publish。

也可以直接检查 registry 和 tarball：

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://registry.npmjs.org/@longbowzz%2Fdsh-codegraph/x.y.z"
```

## 9. tag 和 GitHub Release

npm 发布成功后再执行：

```bash
git tag "vx.y.z"
git push origin "vx.y.z"
gh release create "vx.y.z" --title "vx.y.z" --generate-notes
```

建议在 Release 正文里写清楚：

- Highlights：新功能
- Fixes：修复项
- 安装命令：
  ```bash
  npm i @longbowzz/dsh-codegraph@x.y.z
  ```

## 10. 安装冒烟测试

```bash
rm -rf /tmp/dsh-release /tmp/xdg-release
DSH_HOME=/tmp/dsh-release XDG_DATA_HOME=/tmp/xdg-release \
  dsh plugin --profile test add -w @longbowzz/dsh-codegraph@x.y.z
node -p "require('/tmp/dsh-release/profiles/test/node_modules/@longbowzz/dsh-codegraph/package.json').version"
```

如果版本正确，安装链路就完成了。

## 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| `E401 Unauthorized` | npm 登录态失效 | `npm login`，再 `npm whoami` |
| `PUT ... E404 Not Found` | scoped package 未认证时常被伪装成 404 | 先 `npm whoami`；401 就重新登录 |
| `EOTP` | 需要 2FA 验证码 | `npm publish --otp=<当前验证码>` |
| `EPERM ~/.npm/_cacache` | cache 里有 root 权限文件 | 修 `~/.npm` 权限，或加 `--cache /tmp/...` |
| `E403` | 没有 scope / package 发布权限 | 确认账号和 package owner |
| 发布后立刻 404 | registry 传播延迟 | 等 30–60 秒再查，不要重复 publish |

## 发布后检查清单

- [ ] `npm view @longbowzz/dsh-codegraph version` 是新版本
- [ ] `latest` dist-tag 指向新版本
- [ ] tarball 返回 200
- [ ] GitHub tag 指向 release commit
- [ ] GitHub Release 已创建
- [ ] 临时 DSH profile 安装成功
- [ ] README / SKILL 文档与当前功能一致
