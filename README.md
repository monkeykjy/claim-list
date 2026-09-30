# ClaimList

把事情列出来，大家领着做。面向团队内部的轻量认领清单：管理员录入条目，参与者匿名填写姓名或登录账号认领并完成。

## 当前交付

原匿名版及 [ACC-001 可选账号系统](docs/account-system.md) 已实现。支持一个可配置清单，展示“待认领／进行中／已完成”，未完成条目在前、已完成条目沉底，两组内各按录入顺序排列。部署地址和数据目录可配置，适用于不同团队的单台内网服务器。

- 邮箱、密码、确认密码、姓名注册；邮箱登录，匿名使用可随时跳过登录提示。
- 登录自动关联当前浏览器 UUID 下尚未绑定的已认领条目，包括已完成条目；历史姓名、时间和状态保留，切换账号不转移已有归属。
- 登录认领直接使用账号姓名；账号条目仅所属账号会话可完成，支持跨设备；匿名条目保留 IP **或** UUID 完成规则。
- 管理员查询参与者并重置指定账号密码，撤销其所有会话而保留任务归属；管理员和参与者认证相互独立。
- 批量新增、整批去重、标题修改、删除、更正显示姓名、释放、代为完成和重新打开。
- 管理员一次性初始化、24 小时会话、退出、改密及服务器密码重置；参与者会话固定 30 天，退出只撤销当前会话。
- 清单文案配置、自动刷新、跨标签页身份同步及草稿保护；认领冲突红底红叉、成功绿勾，5 秒后消失。
- 认领、标记完成和管理员代为完成均需二次确认；取消不提交操作，保留姓名输入和原状态。
- SQLite v2 事务迁移、在线备份、停机恢复、两类会话失效和单实例进程锁。

实施清单见 [账号系统开发计划](docs/account-development-plan.md)，证据见 [验收记录](docs/verification.md)。多清单、邮件验证或找回、个人资料编辑、账号删除、评论、通知、看板和自定义工作流不在本轮范围内。匿名条目的共享来源 IP 完成权限局限仍保留，详见 [AUTH-001](docs/known-limitations.md#auth-001)。

## 快速开始

环境：Node.js 22（`.nvmrc` 固定 22.23.1，最低 22.13）、pnpm 11.9.0。安装 nvm 后可执行 `nvm use`；pnpm 版本记录于 `package.json`。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm setup
pnpm dev
```

打开 <http://127.0.0.1:1234>，进入右上角“设置与管理”，输入 `pnpm setup` 输出的一次性口令并设置管理密码。口令不在页面显示，初始化后立即失效；忘记密码用 `pnpm reset:passwd`，不会重新开放初始化入口。

`package.json` 中的 `dev` 和 `start` 均明确指定 `--hostname 0.0.0.0 --port 1234`，监听所有 IPv4 网卡。本机可通过上面的地址访问，其他设备使用 `http://服务器内网IP:1234`。数据库位于 `data/claim-list.sqlite`。`APP_ORIGIN` 默认留空，直连时按本机实际网卡地址执行同源校验；使用域名或反向代理时设置固定来源和受信任代理。命令行参数优先于 `.env` 的 `LISTEN_HOST` / `PORT`，需要改监听地址时修改 package.json 中对应参数。详见 [部署、迁移与恢复](docs/deployment.md)。

## Docker 运行

已提供 [Dockerfile](Dockerfile) 和 [compose.yaml](compose.yaml)，默认映射 `1234:1234`，SQLite 整个 `/data` 目录绑定到宿主机 `./data`，更新镜像或重建容器后保留数据。

```sh
cp .env.docker.example .env.docker
# 内网使用时修改 APP_ORIGIN 为实际访问地址；数据目录默认 ./data。
docker compose --env-file .env.docker build
docker compose --env-file .env.docker run --rm claimlist pnpm setup
docker compose --env-file .env.docker up -d
```

`setup` 仅全新数据库需要执行。已有本机服务占用 1234 时，先配置其他映射端口或按迁移步骤停机切换。完整的更新、备份、恢复及原数据迁入步骤见 [Docker 部署与持久化](docs/docker.md)。

### 容器内初始化管理员

如果容器已经启动，但还没有设置管理员密码，在项目根目录执行：

```sh
docker compose --env-file .env.docker exec --user node claimlist pnpm setup
```

终端会输出一次性初始化口令。打开 `.env.docker` 中 `APP_ORIGIN` 对应的网站地址，进入右上角“设置与管理”，输入该口令并设置管理员密码。密码要求 8–128 个字符，不要求大小写、数字或特殊符号组合；初始化完成后口令立即失效。若已经通过上面的 `run --rm` 命令生成口令，可直接使用，无需再次执行；初始化前重复执行 `setup` 会替换旧口令。

沿用已有 `./data` 且之前已初始化时，直接使用原管理员密码登录，无需重新初始化。忘记密码请使用下面的重置命令。

### 容器内重置管理员密码

保持容器运行，在项目根目录的交互式终端执行：

```sh
docker compose --env-file .env.docker exec --user node claimlist pnpm reset:passwd
```

按提示输入两次新密码，长度同样为 8–128 个字符。输入时不显示字符，也不显示星号，这是正常行为。不要添加 `-T`，也不要通过命令行参数或管道传入密码。

重置成功后，全部旧管理员会话失效，需要用新密码重新登录。任务、认领记录、参与者账号及其密码和会话保持不变。参与者密码由管理员在网页中按账号重置，此命令只重置管理员密码。

## 命令

| 命令                                            | 用途                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`                                      | 启动开发服务器，包含可靠 IP 获取的 Node 入口                                                |
| `pnpm build`                                    | 生成生产构建                                                                                |
| `pnpm start`                                    | 启动生产服务器，使用同一 Node 入口                                                          |
| `pnpm check`                                    | 依次执行 lint、类型和格式检查                                                               |
| `pnpm lint`                                     | ESLint 检查，警告也视为失败                                                                 |
| `pnpm typecheck`                                | 生成路由类型并执行 TypeScript 检查                                                          |
| `pnpm format` / `pnpm format:check`             | 格式化／检查格式                                                                            |
| `pnpm test`                                     | 真实 SQLite、权限、并发进程和备份恢复测试                                                   |
| `pnpm test:e2e`                                 | 浏览器完整流程、异常反馈、刷新和响应式布局测试；先执行 build                                |
| `pnpm test:runtime`                             | 生产进程重启、API 和命令行备份恢复验收；先执行 build，使用临时库和 3120 端口                |
| `pnpm test:docker`                              | 验证 Docker 端口、绑定目录、重启与重建、账号数据保留及备份恢复；先构建 claimlist:local 镜像 |
| `pnpm test:cli`                                 | 在真实伪终端验证隐藏密码输入及重置行为；需要 macOS/Linux 和 Python 3                        |
| `pnpm setup`                                    | 首次设置前生成或旋转一次性初始化口令                                                        |
| `pnpm reset:passwd`                             | 隐藏输入新密码，重置后使全部旧管理会话失效                                                  |
| `pnpm db:migrate`                               | 建立／升级数据库，保留已有业务数据                                                          |
| `pnpm db:backup /path/new.sqlite`               | 在线生成一致性备份，拒绝覆盖已有文件                                                        |
| `pnpm db:restore /path/backup.sqlite --confirm` | 停机恢复，备份原库并使旧会话失效                                                            |

浏览器测试首次运行需安装浏览器：

```sh
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

已有 Chrome 时可运行 `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`。测试使用系统临时目录中的独立数据库和 3100 端口，不修改实际运行库。浏览器测试输出在已忽略的 `test-results/`，验证截图在 [docs/screenshots](docs/screenshots)。CLI 验证同样使用临时数据库，Python 不是应用运行依赖。

## 工程与实现选择

```text
src/app/                 首页、管理页和 HTTP 接口
src/components/          清单及管理交互
src/client/              浏览器 UUID、会话草稿、请求和自动刷新
src/server/              SQLite、认证、授权、业务约束（server-only）
src/shared/              公共类型和输入上限
scripts/                 Node 入口、IP 处理、运维命令与验收辅助
tests/                  数据库和业务集成测试
e2e/                     浏览器验收
deploy/                  systemd、Nginx 示例
docs/                    需求、实施计划、验收与部署说明
```

依赖固定版本并提交锁文件：Next.js 16.3.6、React 19.3.0、Tailwind CSS 4.3.3、TypeScript 5.9.3、better-sqlite3 13.0.3。ESLint 9 满足当前 React 插件兼容范围。`ignore` 的 7.x 分支固定为可获取的 7.0.9，避免上游引用当前仓库不存在的版本；升级时重新核对。SQLite/esbuild 的必要安装脚本在 pnpm 配置中明确允许。

密码使用随机盐与 scrypt 哈希，随机会话令牌只存 SHA-256 摘要；会话 Cookie 为 HttpOnly、SameSite=Strict，HTTPS 时启用 Secure。管理写入在事务内重新授权，管理员密码修改/重置仅删除管理会话；参与者密码重置仅删除目标账号会话。写请求检查站点来源（固定 APP_ORIGIN 或本机实际地址）。管理员、参与者登录和注册使用独立限流命名空间，按 IP 每 15 分钟最多 10 次尝试；参与者登录还按规范化邮箱摘要限制同样次数，包含成功尝试。

标题最多 200 字符、姓名 60、每批 200 条且原文最多 50000 字符；清单名称 80、说明 300、列名 24，密码 8–128 字符，不要求字符组合。邮箱去首尾空白并转小写、最长 254 字符，唯一；不合并点号或 `+` 后缀，姓名可重复。标题仅去首尾空白，精确去重。管理员编辑以条目版本检查并发变化。

UUID 保存在 localStorage，不主动设置有效期；非敏感草稿保存在当前标签页的 sessionStorage，可跨页面刷新保留，关闭标签页后不保证保留。存储不可用时退回当前页面内存并明确提示。密码和初始化口令不写入草稿。无需点击“暂不登录”即可匿名使用；退出账号前弹窗确认。账号切换通过存储事件同步，定时和焦点刷新继续作为补充。

## 部署与验收

本项目交付通用单实例部署方案，不绑定服务器或域名。数据库和环境配置必须在静态目录及 Git 之外；代码发布与持久数据分离。SQLite 使用 WAL，在线备份请使用提供的命令；不能只复制正在运行的主库文件。

已完成本机生产构建、功能测试、浏览器测试和备份恢复验证。目标服务器的系统服务、证书、防火墙及具体内网访问范围，需要部署者按实际环境配置并验收，不能以页面的搜索引擎设置代替访问控制。

- [开发工作计划](docs/development-plan.md)
- [验收记录与测试对应](docs/verification.md)
- [部署、迁移与恢复](docs/deployment.md)
- [账号注册](docs/screenshots/account-register.png) · [账号手机清单](docs/screenshots/account-mobile.png) · [参与者密码管理](docs/screenshots/account-admin.png)
- [桌面清单](docs/screenshots/list-desktop.png) · [手机清单](docs/screenshots/list-mobile.png) · [管理页面](docs/screenshots/admin-desktop.png)

## 需求与维护入口

优先阅读新增的 [ACC-001 可选账号系统](docs/account-system.md)，再结合下列基线文档实施。

1. [仓库协作说明](AGENTS.md)
2. [第一版产品需求](docs/product-requirements.md)
3. [页面与状态说明](docs/pages-and-states.md)
4. [已知局限与后续优化](docs/known-limitations.md#auth-001)
5. [研发交接](docs/development-handoff.md)

保留仓库已有 MIT 许可证。
