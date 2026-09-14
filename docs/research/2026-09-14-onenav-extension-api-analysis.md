# OneNav 浏览器扩展 API 调用分析（2026-09-14）

> 对象：OneNav 官方扩展 v1.1.0（Firefox XPI 解包实证，`/tmp/onenav-ext/`；Chrome 商店版同版本号同源）。
> 对照：PHP 服务端 `../onenav/class/Api.php` 与 navbook 现状（版本 `9125cf67` 之后）。

## 一、认证方式

**单因子 token，纯 form body 传递**：

- 配置项只有两个字段：`domain`（站点地址）+ `token`（从 OneNav 后台复制的 API Token）
- token 来源：服务端生成 `md5(用户名 + SecretKey)`，用户手工复制进扩展
- **每个请求都把 `token` 作为 URLSearchParams form 字段随 body 发送**——不用 header、不用 cookie、不本地计算
- 扩展把 `api_domain` / `api_token` 存 localStorage；`category_list` / `links_<fid>` 结果也做本地缓存（调过后不再刷新，删链接时精准失效对应缓存）
- 无过期/刷新机制：SecretKey 重新生成 = token 换新，旧 token 立即失效
- 服务端（PHP `auth($token)`）逐端点验证；失败返回 HTTP 200 + `{code:-1002, err_msg}`（**HTTP 永远 200，错误靠 code 区分**）

## 二、调用形态

```
POST {domain}/index.php?c=api&method=<方法名>
Content-Type: application/x-www-form-urlencoded（URLSearchParams）
body: token=...&<业务参数>
query: 分页参数（&page=1&limit=999）
```

- URL 是**无伪静态形态**（`/index.php?c=api&method=...`），不依赖服务器 rewrite
- 全部 POST（包括列表查询）
- 响应判定：`check_login`/`app_info` 判 `code==200`；数据端点判 `code==0`；**错误提示一律读 `err_msg` 字段**
- 网络异常（非 2xx / CORS 失败）catch 后提示"程序异常/发生异常"

## 三、端点清单与三方对照

| 端点 | 参数 | 成功判定 / 读取字段 | PHP | navbook 现状 |
|---|---|---|---|---|
| `check_login` | body: token | `code==200` | `return_json(200,"true","success")` | ✅ 已对齐（code 200 + data "true"） |
| `app_info` | body: token | `code==200` → 读 `data.onenav_version`：`split('-')[0]` 去 `v` 后 parseFloat，**合法区间 [0.9, 2)——v≥2 报"发生异常"** | `return_json(200, data, "success")` | ✅ `onenav_version: "v1.2.4-navbook"`（版本区间坑已绕开） |
| `category_list` | query: page/limit；body: token | `code==0` → `data` 数组（本地缓存） | 全量分类 | ✅（额外返回 count 无害） |
| `q_category_link` | query: page/limit；body: category_id, token | `code==0` → `data` 链接数组 | 分类下链接 | ✅ |
| `add_link` | body: url, title, fid, weight, description, property, token | `code==0`；失败读 err_msg | 新增链接 | ✅（字段全兼容） |
| `del_link` | body: id, token | `code==0` | 删除链接 | ✅ |
| `global_search` | body: keyword, token | `code==0` → `data`（取前 20 条渲染，显示 `category_name`）；keyword 2-32 字符 | 四字段 LIKE + category_name | ✅ 已实现（title/url/url_standby/description 匹配 + category_name） |
| **`/index.php?c=admin&page=edit_link&id=<N>`** | — | `window.open` 打开**网页**（非 API）：PHP 后台编辑页 | admin 控制器 | ⚠️ **缺口**：我们的 `/index.php` 入口只认 `c=api`，`c=admin` 落 302 首页。且 web 后台尚无链接编辑 UI（Phase 2 项） |

**插件渲染读取的链接字段**：`id / fid / title / url / description`（+ global_search 的 `category_name`）。**不读** `add_time / url_standby / font_icon / topping / click`——因此 navbook 返回 camelCase 扩展字段（addTime/urlStandby 等）对插件无害，关键字段名两边一致。

## 四、navbook 侧为兼容所做的全部适配（已上线）

1. `/index.php?c=api&method=<m>` 入口 → 内部转发 `/api/<m>`（query/body 原样保留）
2. token 三通道：X-Token header > `?token=` > form body（中间件级，全端点生效）
3. `check_login` 响应形状 `{code:200, data:"true", msg:"success"}`
4. `app_info`：`code:200` + `onenav_version`（版本值取 [0.9,2) 区间）
5. 所有错误响应补 `err_msg` 字段
6. `global_search` 新端点（PHP 行为对齐：原样 LIKE、weight desc、limit 100）
7. 5 个列表端点支持 GET+POST（写操作保持 POST-only）

## 五、遗留缺口

| 缺口 | 影响 | 归属 |
|---|---|---|
| `c=admin` 网页路由（edit_link 深链） | 插件点"编辑"打开的是首页而非编辑页 | Phase 2：web 后台补链接编辑 UI + `/index.php?c=admin&page=...` 映射到 admin SPA 对应路由 |
| 插件端 localStorage 缓存不主动失效 | 后台改数据后插件弹窗可能显示旧缓存（关弹窗重开/重装插件可清） | 插件自身行为，服务端无法控制 |

## 附：插件端点调用原始证据（解包源码摘录）

```js
// check_login（设置页"测试"按钮）
const c = new URLSearchParams; c.append("token", r.value.token);
let f = r.value.domain + "/index.php?c=api&method=check_login";
Be.post(f, c).then(p => p.data.code == 200 ? 测试通过 : "验证失败：" + p.data.err_msg)

// app_info 版本门槛
let v = p.data.data.onenav_version;   // "v1.2.4-xxx" → 1.2.4
if (v < min_version) 报"版本过低"; else if (v >= 2) 报"发生异常";   // 合法区间 [0.9, 2)

// background.js 右键菜单添加书签
fetch(`${domain}/index.php?c=api&method=add_link`, {
  method: "POST", body: M,   // url/title/fid/property/token
  headers: { "Content-Type": "application/x-www-form-urlencoded" }
})
```
