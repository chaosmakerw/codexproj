# 俗世神人

一个本地运行的网络争议人物记录网站，用来整理褒贬不一、评价两极、在互联网上留下强烈公众印象的人物。

## 功能

- 手动录入人物记录
- TXT / JSON 导入
- 编辑、删除、导出
- 本地搜索
- 审核状态：待审核、已通过、已驳回
- Supabase 公共数据库：登录投稿、角色审核
- AI 功能已暂时封存，保留为“有待开发”

## 启动

确保本机已安装 Node.js，然后在项目目录运行：

```bash
node server.js
```

打开：

```text
http://localhost:4173
```

也可以直接打开 `index.html` 使用纯静态模式；此时记录会保存在浏览器本地。

## 数据

未配置 Supabase 时，记录会保存在本地浏览器或本地服务的 `data/people.json`。  
点击页面里的“导出 JSON”可以做备份。

## 投稿与审核

配置 Supabase 后，网站支持公共数据库：

- 未登录访客：只能查看已通过记录
- 登录用户：可以投稿，投稿默认进入待审核
- reviewer / admin：可以查看待审核记录并通过或驳回

未配置 Supabase 时，GitHub Pages 仍是静态网站，访客提交内容只会留在访客自己的浏览器里。

推荐流程：

1. 朋友在网页里填写记录。
2. 朋友点击“导出 JSON”。
3. 朋友把 JSON 文件发给站主。
4. 站主在自己的页面导入 JSON。
5. 站主在“待审核”里选择通过或驳回。

## 配置 Supabase 公共数据库

1. 创建 Supabase 项目。
2. 在 Supabase SQL Editor 运行 `supabase/schema.sql`。
3. 在 Authentication 设置里启用 Email 登录。
4. 至少用你的邮箱登录网站一次，让 `profiles` 自动生成账号资料。
5. 回到 SQL Editor，把自己设为 admin：

```sql
update public.profiles
set role = 'admin'
where email = '你的邮箱@example.com';
```

6. 给朋友审核权限：

```sql
update public.profiles
set role = 'reviewer'
where email = '朋友邮箱@example.com';
```

7. 在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

8. 重新运行 GitHub Pages workflow。部署时会自动生成 `config.js`。

本地开发时，可以复制配置模板：

```bash
cp config.example.js config.js
```

然后把 `config.js` 里的 Supabase URL 和 anon key 换成你的项目值。

## 项目结构

- `index.html` 页面结构
- `styles.css` 页面样式
- `app.js` 前端逻辑
- `server.js` 本地服务
- `supabase/schema.sql` 公共数据库与权限规则
- `config.example.js` Supabase 配置模板

## 部署

仓库包含 GitHub Pages 工作流，公开仓库并启用 Pages 后会自动部署静态页面。

## 说明

AI 自动建档和 AI 搜索当前已封存，仅保留界面占位，后续确认稳定的 API、网络和费用方案后再启用。
