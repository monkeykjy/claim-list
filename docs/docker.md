# Docker 部署与持久化

仓库提供多阶段 [Dockerfile](../Dockerfile)、[Compose 配置](../compose.yaml) 和 [.env.docker.example](../.env.docker.example)。容器使用 Node.js 22、生产构建和项目自定义服务入口，监听 `0.0.0.0:1234`。默认宿主机映射为 `1234:1234`，整个 `/data` 挂载到宿主机目录。

## 构建与首次启动

需要 Docker Engine/Desktop 和 Compose 插件。在仓库根目录执行：

```sh
cp .env.docker.example .env.docker
```

按实际环境编辑 `.env.docker`：

```dotenv
CLAIMLIST_BIND_IP=0.0.0.0
CLAIMLIST_PORT=1234
APP_ORIGIN=http://192.168.1.100:1234
CLAIMLIST_DATA_DIR=./data
TRUSTED_PROXY_IPS=
```

其中 `APP_ORIGIN` 替换为浏览器实际使用的域名或宿主机 IP，包含协议和映射端口、不含尾斜杠。仅本机使用时可保留示例中的 `http://localhost:1234`。容器只能看到自身网卡，无法自动识别宿主机地址，所以内网访问时应显式配置；改端口后同步改 `APP_ORIGIN`。生产数据目录推荐使用发布目录之外的固定绝对路径。默认 `./data` 适合在固定目录下使用，已加入 Git 和 Docker 构建忽略规则。

```sh
docker compose --env-file .env.docker build
# 仅全新数据库执行，输出一次性初始化口令，请私下保存。
docker compose --env-file .env.docker run --rm claimlist pnpm setup
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

打开 `APP_ORIGIN` 对应地址，进入“设置与管理”，用初始化口令设置管理密码。已有初始化数据时跳过 `pnpm setup`，原管理密码与参与者账号继续使用。运行中的未初始化站点也可以执行 `docker compose --env-file .env.docker exec --user node claimlist pnpm setup`。

镜像不会打包宿主机 `.env`、SQLite 数据或 `node_modules`，原生 SQLite 依赖在 Linux 构建阶段安装。运行时将专用数据目录及其中已有文件的属主统一为 UID/GID 1000，然后降权为 `node`（UID/GID 1000）执行应用。目录需要支持本地文件锁并允许 UID 1000 写入；不要将数据库目录共享给多个独立应用或放到网络文件系统。导入已有文件时优先使用下方备份恢复流程，以自动生成正确权限。

## 数据保存在哪里

| 内容                   | 默认位置                                                     |
| ---------------------- | ------------------------------------------------------------ |
| 容器内数据库           | `/data/claim-list.sqlite`                                    |
| 宿主机数据库           | `./data/claim-list.sqlite`，或 `CLAIMLIST_DATA_DIR` 指定目录 |
| WAL、SHM、进程及容器锁 | 同一个 `/data` 目录                                          |
| 下方命令生成的备份     | `/data/backups/`，即宿主机数据目录的 `backups/`              |

账号、密码哈希、任务、认领归属、完成情况、清单设置和会话都保存在 SQLite 中。重启、删除或重新创建容器、重新构建镜像不会删除宿主机挂载目录。不要删除或更换 `CLAIMLIST_DATA_DIR`；换了路径就会看到另一个数据库。持久化不能替代备份，应将备份另存到独立持久磁盘。

容器入口使用 Linux `flock` 保护同一数据库，拿到独占锁后清理旧 PID 锁。这样强制终止、容器重建或 PID 重用不会导致旧锁永久阻止启动。第二个容器尝试使用同一数据库时退出码为 73。此保证适用于使用本镜像默认入口的容器；不要绕过入口，也不要让宿主机 Node 服务和容器同时使用同一数据目录。

## 更新项目

保留同一份 `.env.docker` 和同一个绝对数据目录：

```sh
# 每次用新的备份文件名，命令拒绝覆盖已有备份。
docker compose --env-file .env.docker exec --user node claimlist pnpm db:backup /data/backups/before-update-20260930.sqlite
# 更新代码后构建新镜像，旧容器此时仍可服务。
docker compose --env-file .env.docker build
# 短暂停机后迁移，成功再启动新容器。
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker run --rm claimlist pnpm db:migrate
docker compose --env-file .env.docker up -d --force-recreate
docker compose --env-file .env.docker ps
```

迁移失败时先检查错误并保留数据和快照，不用空目录替代原库。数据库版本回退规则见 [部署说明](deployment.md#从匿名版-v1-升级到账号版-v2)。`docker compose down` 仅删除服务容器和网络，当前配置的宿主机绑定目录仍保留。

## 备份、恢复与密码重置

在线备份（不要直接复制正在写入的 SQLite 主文件）：

```sh
docker compose --env-file .env.docker exec --user node claimlist pnpm db:backup /data/backups/snapshot-20260930.sqlite
```

停机恢复，支持 v1/v2 备份，恢复前会自动保留当前库快照，恢复后管理员和参与者均需重新登录：

```sh
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker run --rm claimlist pnpm db:restore /data/backups/snapshot-20260930.sqlite --confirm
docker compose --env-file .env.docker up -d
```

重置管理员密码，保留交互式终端的隐藏输入，不影响参与者密码及会话：

```sh
docker compose --env-file .env.docker exec --user node claimlist pnpm reset:passwd
```

`exec` 在当前运行容器中执行维护；`run` 创建单次维护容器并尝试取得独占数据锁，因此迁移和恢复前必须停服务。参与者密码仍由管理员在网页中按账号重置。

## 从现有 pnpm 服务迁入容器

1. 在原服务仍可用时执行 `pnpm db:backup /安全目录/migration.sqlite`，生成一致性快照。
2. 停止原服务，避免两边继续写入造成数据分叉。需要包括最后的写入时，停机后再用新的文件名备份。
3. 默认 `CLAIMLIST_DATA_DIR=./data` 直接沿用当前项目数据目录：保留备份、停止原服务后执行 `docker compose --env-file .env.docker up -d` 即可，无需再次初始化或复制数据库。容器会调整该专用目录及已有文件的属主以便 UID 1000 读写；在 Linux 上若以后切回宿主机运行，需将目录属主改回对应服务用户。
4. 若使用新的数据目录，配置独立容器数据目录和相同的浏览器访问地址。保持域名/协议/端口可让浏览器继续使用原 localStorage UUID；改变来源不会自动带走浏览器的匿名 UUID。
5. 将快照通过临时只读挂载复制到容器备份目录，设置副本的读取权限，再恢复到持久目录。原快照权限不变；以下复制步骤在服务已停止时执行：

   ```sh
   docker compose --env-file .env.docker run --rm --entrypoint sh \
     -v /安全目录/migration.sqlite:/backup/migration.sqlite:ro \
     claimlist -c 'test ! -e /data/backups/migration.sqlite && mkdir -p /data/backups && cp /backup/migration.sqlite /data/backups/migration.sqlite && chown 1000:1000 /data/backups /data/backups/migration.sqlite && chmod 700 /data/backups && chmod 600 /data/backups/migration.sqlite'
   docker compose --env-file .env.docker run --rm \
     claimlist pnpm db:restore /data/backups/migration.sqlite --confirm
   docker compose --env-file .env.docker up -d
   ```

原账号和归属保留，两类会话失效后重新登录。当前本机 1234 端口已有 pnpm 服务时，首次试运行容器可先用另一个宿主机端口并同步配置 `APP_ORIGIN`；正式切换时再停原服务。

## 不使用 Compose

```sh
docker build -t claimlist:local .
docker volume create claimlist-data
docker run --rm -v claimlist-data:/data claimlist:local pnpm setup
docker run -d --name claimlist --init --restart unless-stopped \
  -p 1234:1234 \
  -e APP_ORIGIN=http://localhost:1234 \
  -v claimlist-data:/data \
  claimlist:local
```

这里使用命名卷 `claimlist-data`。重建时继续挂载同一卷，不执行 `docker volume rm claimlist-data`；若希望直接管理宿主机目录，将 `-v claimlist-data:/data` 换成 `--mount type=bind,source=/绝对数据目录,target=/data`，提前创建该目录。

## 来源 IP 与代理

默认映射监听所有宿主机网卡，可用 `CLAIMLIST_BIND_IP` 指定内网地址；通过目标服务器防火墙限制内网访问。Docker Desktop/NAT 等环境可能使应用看到网关 IP，此时匿名 IP OR UUID 规则的共享 IP 局限仍存在，见 [AUTH-001](known-limitations.md#auth-001)。账号条目始终要求所属账号会话，不回退到 IP。

通过可信代理部署时设置实际 `APP_ORIGIN` 和容器所见的精确代理 IP `TRUSTED_PROXY_IPS`，由代理覆盖 `X-Real-IP`，同时限制应用端口只能由代理访问。不要为了适配容器而信任任意访客提交的转发头。

## 验证

```sh
docker build -t claimlist:local .
pnpm test:docker
```

测试创建独立 Compose 项目和 `data/docker-verification-*` 临时绑定目录，默认只映射本机 `3124` 端口，不修改现有服务和数据库；结束后删除测试容器、网络及测试数据。可设置 `CLAIMLIST_DOCKER_TEST_PORT` 改测试端口。覆盖账号与任务创建、正常重启、强制终止、重建容器、跨容器锁、在线备份和离线恢复，以及健康检查。
