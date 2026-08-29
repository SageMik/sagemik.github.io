---
title: 通过 GitHub Actions 将 鸿蒙 HAR 包 发布到 OpenHarmony 三方库中心仓
published: 2026-07-26T01:00:00+08:00
updated: 2026-07-26T01:00:00+08:00
category: 鸿蒙开发
tags:
  - GitHub Actions
  - 鸿蒙
  - ohpm
  - CI/CD
  - Hvigor
author: SageMik
---

# 通过 GitHub Actions 将 鸿蒙 HAR 包 发布到 OpenHarmony 三方库中心仓

## 引言

[GitHub Actions](https://docs.github.com/zh/actions) 是 GitHub 官方提供的 **持续集成/持续交付（CI/CD）** 服务。通过 GitHub Actions 工作流，我们可以将 [HAR 包](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/har-package) 发布到 **鸿蒙官方包管理平台 [OpenHarmony 三方库中心仓](https://ohpm.openharmony.cn/)**，从而省去繁琐的手动操作，实现高效的持续交付。

作为操作系统领域的后起之秀，鸿蒙虽已初具规模，但与 Android、iOS 等深耕多年的先行者相比，其生态成熟度和工程化实践仍然有待完善。本文便是基于此背景的一次技术探索，旨在验证通过 GitHub Actions 鸿蒙自动化发布的可行性，并帮助开发者规避潜在陷阱，填补实践空白。

## 核心挑战

GitHub Actions 支持通过命令行执行任务，而鸿蒙官方也提供了用于鸿蒙项目开发构建的[命令行工具](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-commandline-get)，其中用于发布的核心命令是 [ohpm publish](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-ohpm-publish)，一个简单示例如下：

```shell
ohpm publish $har_path \
  --publish_registry=https://ohpm.openharmony.cn/ohpm \
  --publish_id=$publish_id \
  --key_path=$key_path
```

<span id="ohpm-publish-params"></span>

| 参数                   | 说明                                                                                                                                                                                |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `$har_path`          | 编译生成的 HAR 包路径，例如 `模块名/build/default/outputs/default/模块名.har`                                                                                                                      |
| `--publish_registry` | 发布仓库地址，本文使用 `https://ohpm.openharmony.cn/ohpm`，即 OpenHarmony 三方库中心仓                                                                                                               |
| `--publish_id`       | 发布码，根据 [创建及发布三方库 - 发布准备](https://ohpm.openharmony.cn/#/cn/help/createandpublish) 获取                                                                                               |
| `--key_path`         | SSH 私钥所在文件路径，文件内容通常是以 `-----BEGIN RSA PRIVATE KEY-----` 开头的长文本，可以根据 [认证管理](https://ohpm.openharmony.cn/#/cn/help/certifymanage) 生成或者使用已有私钥；<br />生成后私钥文件路径作为命令行参数使用，公钥则根据说明添加到中央仓 |
| SSH 私钥密码             | 生成 SSH 私钥时输入的密码，根据说明 [加密后配置到 `ohpmrc` 文件](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-ohpmrc#section10698175182316)，或者在命令的执行过程交互式输入                         |

> [!TIP]
>
>  `--publish_id`、`--key_path` 指定的 SSH 私钥文件，以及 SSH 私钥密码，均属于开发者的敏感信息，不应明文存储，因而需要借助 [GitHub Secret](https://githubdocs.cn/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions?tool=webui) 提供安全存储与运行时注入。

由此，我们引出在 GitHub Actions 发布鸿蒙 HAR 包的核心挑战：

1. 发布需要配置鸿蒙开发环境，但官方提供的命令行工具需要登录验证后方能下载，这在纯命令行的自动化环境中分析起来着实棘手，可有解决方案？
2. 将 SSH 私钥密码配置到 `ohpmrc` 涉及文件覆盖的风险，采用交互输入又受制于 GitHub Actions 本身不支持的固有限制，又当如何处理？

工欲善其事，必先利其器。针对上述挑战，我们引入如下工具：

1. **[@ErBWs/setup-ohos](https://github.com/ErBWs/setup-ohos)**：为下载命令行工具分析整套登录流程，未免费时费力且收效甚微，一个更务实的策略是：自行下载命令行工具，经由免认证渠道二次分发后，提供给 GitHub Actions 使用。`@ErBWs/setup-ohos` 便是这一思路的实践典范，它依托 [`@ErBWs/ohos-sdk`](https://github.com/ErBWs/ohos-sdk) 的 Release 托管命令行工具，使开发者不必再耗费心力于环境的搭建，可以专心聚焦于发布流程本身。
2. **[hvigor-ohpm-publish](https://github.com/SageMik/hvigor-ohpm-publish)**：如前文所言，SSH 私钥密码作为敏感信息，应当配置到 GitHub Secret 并在运行时动态获取。获取后，如果要配置到 `ohpmrc` 中，不仅要执行繁冗的加密流程，还要考虑诸如文件读写中断、用户已有配置被意外覆盖等风险。当然，这些风险对个人使用场景来说稍加注意便可规避，但本文旨在将这一流程封装为简化自动发布、可在不同项目中复用的插件，必须充分考虑场景的多样性。由此，通过 [node-pty](https://github.com/microsoft/node-pty) 创建伪终端模拟用户交互输入的 `hvigor-ohpm-publish` 应运而生。开发者只需在 Hvigor 配置中引入插件并通过环境变量传递必要信息，即可将原本复杂的发布操作转化为一条简洁的 `hvigorw ohpmPublish` 命令。

至此，我们的关键工具已经准备妥当，可以开始搭建自动化发布的流水线了。

## 完整示例

以鸿蒙项目 [`simple-native-ohos`](https://github.com/SageMik/sqlite3_simple/tree/Nv2.2.0) 为例，下文将详细阐述完整的配置流程。

### 1. 添加 `hvigor-ohpm-publish` 插件

参考官方对 [使用自定义 Hvigor 插件](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-hvigor-plugin#section60171414358) 的说明，在鸿蒙项目根目录的 [`hvigor/hvigor-config.json5`](https://github.com/SageMik/sqlite3_simple/blob/Nv2.2.0/src/ohos/hvigor/hvigor-config.json5) 中添加 `hvigor-ohpm-publish` 插件：

```json
{
  "dependencies": {
    "hvigor-ohpm-publish": "^0.0.3"
  },
}
```

在需要发布的模块例如 [`simple_native_ohos/hvigorfile.ts`](https://github.com/SageMik/sqlite3_simple/blob/Nv2.2.0/src/ohos/simple_native_ohos/hvigorfile.ts) 中引入 `ohpmPublishPlugin` 注册发布任务：

```ts
import { harTasks } from '@ohos/hvigor-ohos-plugin';
import { ohpmPublishPlugin } from 'hvigor-ohpm-publish'

export default {
    system: harTasks,  /* Built-in plugin of Hvigor. It cannot be modified. */
    plugins:[ohpmPublishPlugin()]         /* Custom plugin to extend the functionality of Hvigor. */
}
```

`ohpmPublishPlugin` 提供了如下参数：

| 参数 | [`ohpm publish` 对应参数](#ohpm-publish-params) | 说明 |
| --- | --- | --- |
| `harPath` | `$har_path` | 编译生成的 HAR 包路径，默认当前注册模块的 `build/default/outputs/default/模块名.har` |
| `publishId` | `--publish_id` | 发布码，默认 `process.env.OHPM_PUBLISH_ID` ，即环境变量 `OHPM_PUBLISH_ID` |
| `key` | - | SSH 私钥文件内容，默认 `process.env.OHPM_KEY` ，即环境变量 `OHPM_KEY` |
| `keyTmpPath` | `--key_path` | SSH 私钥文件临时路径，执行发布任务时会将 `key` 参数写到该临时路径，作为 `ohpm publish` 的 `--key_path` 参数 |
| `keyPassphrase` | - | SSH 私钥密码，默认 `process.env.OHPM_KEY_PASSPHRASE` ，即环境变量 `OHPM_KEY_PASSPHRASE` |

在 DevEco Studio 中点击 Sync Now 或者执行 `hvigorw --sync` 命令进行同步后，控制台输出如下日志表明成功添加插件：

```text
🚀 OHPM Publish Plugin initialized!
☑️ Task `ohpmPublish` registered for module: simple-native-ohos
```

插件采用灵活的配置策略，支持通过 `ohpmPublishPlugin({ key: <TypeScript Code> })` 指定任意来源，并不强制依赖环境变量，只不过利用环境变量承接 GitHub Secrets 传递给具体任务确实是最常见的方式。

> [!IMPORTANT]
>
> 由于 Hvigor 存在其他构建工具也存在的守护进程机制，而守护进程仅在启动时会继承当时的环境变量快照，在终端中对环境变量的修改无法自动同步到已运行的守护进程，**因此如果出现没有正确读取环境变量的情况，需要在命令上增加 `--no-daemon` 参数。**

### 2. 编写工作流

编写发布工作流文件 [`.github/workflows/simple.yml`](https://github.com/SageMik/sqlite3_simple/blob/1885643abb2b65f212b20892af47223eb2747818/.github/workflows/simple.yml#L178-L207) 如下：

```yml
name: 编译 Simple 原生库

on:
  push:
    tags: # 推送 Nv 开头的标签时触发
      - Nv*
  workflow_dispatch: # 手动触发

jobs:
  HarmonyOS:
    runs-on: ubuntu-latest
    environment: simple-native-ohos

    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true

      - name: '配置允许 node-pty 构建脚本'
        run: echo 'only-built-dependencies[]=node-pty' >> ~/.npmrc

      - name: '设置 HarmonyOS 环境'
        uses: ErBWs/setup-ohos@v1
        with:
          version: 6.0.0.858
          cache: true

      - name: '通过 Hvigor 编译'
        run: hvigorw --mode module -p product=default -p module=simple_native_ohos@default -p buildMode=release assembleHar --analyze=normal --parallel --incremental --daemon
        working-directory: src/ohos

      - name: '发布至 OpenHarmony 三方库'
        run: hvigorw ohpmPublish --mode module -p product=default -p module=simple_native_ohos@default -p buildMode=release --analyze=normal --parallel --incremental --no-daemon
        env:
          OHPM_KEY: ${{ secrets.OHPM_KEY }}
          OHPM_KEY_PASSPHRASE: ${{ secrets.OHPM_KEY_PASSPHRASE }}
          OHPM_PUBLISH_ID: ${{ secrets.OHPM_PUBLISH_ID }}
        working-directory: src/ohos
```

工作流文件的开头配置了两种触发工作流的方式：推送 `Nv` 开头的标签时自动触发，或手动触发。具体触发方式，可根据项目实际要求自行配置。

任务名称 `HarmonyOS` 和 `environment` (用于指定读取哪组 GitHub Secrets) 均可自定义，只要与后文配置一致即可。各步骤说明如下：

| 步骤 | 说明 |
| --- | --- |
| 配置允许 node-pty 构建脚本 | `hvigor-ohpm-publish` 插件依赖 `node-pty` 库模拟用户输入，该库包含原生模块，需要允许 `pnpm` 在安装时执行编译脚本。此命令可同时解决 `hvigor` 提示找不到 `.npmrc` 的问题 |
| 设置 HarmonyOS 环境 | 配置鸿蒙环境 |
| 通过 Hvigor 编译 | 将模块编译为 Release 版本的 HAR 包；<br />在 DevEco Studio 中点开 Product 图标修改 `Build Mode` 为 `release`，然后选中需要发布的模块点击 `File -> Build -> Make Module '模块名'` 进行编译，会在构建窗口打印出这条命令 **（如下图所示）**。换言之，IDE 中这些可视化操作就是对底层命令行工具的封装 |
| 发布至 OpenHarmony 三方库 | 执行 `hvigor-ohpm-publish` 注册的发布任务。如前文所述，此处读取 GitHub Secrets 并更新了环境变量，**需要添加 `--no-daemon` 解决守护进程缓存旧环境变量的问题** |

![修改 Build Mode 为 Release](BuildModeRelease.png)

![选中模块并执行编译](MakeModule.png)

![编译命令](CompileCommand.png)

![编译产物](CompileOutput.png)

### 3. 配置 GitHub Secrets

打开项目仓库，点击 `Settings -> Secrets and variables -> Manage environment secrets` 配置发布凭证到工作流文件指定的 `environment` 。此外，可根据实际需要设置可读取指定环境中 GitHub Secrets 的分支和标签 `Deployment branches and tags` 。

如图所示，我们为 `simple-native-ohos` 环境配置了 `OHPM_KEY` 、`OHPM_KEY_PASSPHRASE` 、`OHPM_PUBLISH_ID` 三个 GitHub Secrets，与前文鸿蒙项目和工作流文件的配置保持一致：

![GitHub Secrets](GitHubSecrets.png)

![配置环境机密](ConfigureEnvironment.png)

### 4. 执行发布工作流

完成以上工作后，即可通过工作流文件中配置的触发方式执行发布工作流。当工作流日志输出 `Thanks for your contribution, the submitted OHPM library is under review...` 时，表明 HAR 包已顺利提交至中心仓等待审核。例如这条工作流的[运行记录](https://github.com/SageMik/sqlite3_simple/actions/runs/26588702420/job/78342368296)：

![发布成功](PublishSuccess.png)

至此，我们顺利完成了鸿蒙 HAR 包的自动化发布流程。

## `hvigor-ohpm-publish` 原理简析

如前文所展示的，[`hvigor-ohpm-publish`](https://github.com/SageMik/hvigor-ohpm-publish) 在自动化发布流程中发挥了关键作用。但其实在最初的探索实践中，并未考虑到 [定制 Hvigor 插件](https://developer.huawei.com/consumer/cn/doc/best-practices/bpta-custom-hvigor-plugin) 的方案。彼时为解决交互输入问题，依赖的是 [Expect](https://core.tcl-lang.org/expect/index) 脚本方案（可参阅旧版 `simple-native` 的 [工作流](https://github.com/SageMik/sqlite3_simple/blob/21f7fe326bd7a9607eb877964efd5021fc2d5b7d/.github/workflows/simple.yml#L178-L206) 和 [Expect 脚本](https://github.com/SageMik/sqlite3_simple/blob/Nv2.1.0/src/ohos/publish.exp) 实现）。该方案的局限性是每个鸿蒙项目都要维护一份副本，复用性欠佳。

有鉴于此，受到安卓生态下 [`gradle-maven-publish-plugin`](https://vanniktech.github.io/gradle-maven-publish-plugin/central/#secrets) 插件的启发，最终选择了 `hvigor-ohpm-publish` 这一自定义 Hvigor 插件实现，为鸿蒙生态贡献了一份自动化发布的实践方案。

插件开发过程中，还遇到了因伪终端存在输入缓冲与背压限制导致 `ohpm publish` 无法一次性接收完整内容的问题，一度令人困扰。几经尝试，最终通过改为 [逐字符延迟输入](https://github.com/SageMik/hvigor-ohpm-publish/blob/c0940b0e993ef1efeeb04601d9640eae006e86c0/src/ohpm-publish-plugin.ts#L89-L104) 成功解决：

```typescript
if (buf.lastIndexOf("what is your passphrase of the private key:") >= 0) {
  if (hasKeyPassphraseSent && !error) {
      error = new Error(`OHPM publish failed with wrong key passphrase`);
      proc.kill();
      return;
  }
  hasKeyPassphraseSent = true;
  let i = 0;
  const iv = setInterval(() => { // 直接输入 ohpm 无法接收，因此需要分字符输入
      if (i < keyPassphrase.length) { 
          proc.write(keyPassphrase.charAt(i++)); 
      } else { 
          clearInterval(iv); 
          proc.write("\r"); 
      }
  }, 1);
  buf = "";
}
```

此外，如果在 Windows 上执行 `hvigorw ohpmPublish` 发布命令，在发布成功后还需要等待大约五秒才能结束进程。此现象源于 node-pty 的 [一个已知问题](https://github.com/microsoft/node-pty/issues/887)，不影响实际发布流程，但还是建议在 GitHub Actions 中使用非 Windows 运行环境，避免不必要的等待开销。

## 总结

本文探讨了通过 GitHub Actions 实现 HAR 包自动化发布的完整方案，通过 [@ErBWs/setup-ohos](https://github.com/ErBWs/setup-ohos) 解决鸿蒙环境配置，通过 [hvigor-ohpm-publish](https://github.com/SageMik/hvigor-ohpm-publish) 简化发布凭证配置，最终将整个自动化发布流程凝练为两大步骤：配置 GitHub Secrets，并执行 `hvigorw ohpmPublish` 命令。目前 `hvigor-ohpm-publish` 插件已经在 [simple-native](https://github.com/SageMik/sqlite3_simple/tree/simple-native) 和 [sqlite-native-libraries](https://github.com/SageMik/sqlite-native-libraries) 项目中落地使用，可供参阅。
