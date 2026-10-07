using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

// The tray owns only the process tree that it starts. WeChat is never manipulated.
class Shishi : ApplicationContext {
 const string Home="http://127.0.0.1:4317/";
 readonly string root=AppDomain.CurrentDomain.BaseDirectory;
 NotifyIcon tray; Process service; System.Windows.Forms.Timer timer;
 bool busy=false, closing=false; int failures=0;
 [STAThread] static void Main(string[] args) {
  Application.EnableVisualStyles();
  if(args.Length>0 && args[0]!="--background" && args[0]!="--register" && args[0]!="shishi://connect" && args[0]!="shishi://connect/" && args[0]!="shishi://open" && args[0]!="shishi://open/")return;
  if(args.Length>0&&args[0]=="--register"){Register();return;}
  bool first;using(var mutex=new Mutex(true,"Local\\ShishiDesktop-"+Environment.UserName,out first)){
   if(!first){if(args.Length==0||args[0]!="--background")Open("#settings");return;}
   Application.Run(new Shishi(args.Length>0&&args[0]=="--background"));
  }
 }
 static void Register(){
  string exe=Application.ExecutablePath;
  using(var key=Registry.CurrentUser.CreateSubKey("Software\\Classes\\shishi")){
   key.SetValue("","URL:Shishi");key.SetValue("URL Protocol","");
   using(var command=key.CreateSubKey("shell\\open\\command"))command.SetValue("","\""+exe+"\" \"%1\"");
  }
 }
 static bool Healthy(){try{var request=(HttpWebRequest)WebRequest.Create(Home+"health");request.Timeout=1500;request.Proxy=null;using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))return reader.ReadToEnd().Contains("\"app\":\"shishi\"");}catch{return false;}}
 static void Open(string fragment){
  string edge=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Microsoft\\Edge\\Application\\msedge.exe");
  if(!File.Exists(edge))edge=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Microsoft\\Edge\\Application\\msedge.exe");
  if(File.Exists(edge))Process.Start(new ProcessStartInfo(edge,"--app="+Home+fragment){UseShellExecute=false});
  else Process.Start(Home+fragment);
 }
 Shishi(bool background){
  Register();Directory.CreateDirectory(Path.Combine(root,"data"));
  var menu=new ContextMenuStrip();menu.Items.Add("打开拾事",null,(s,e)=>Connect("#inbox"));menu.Items.Add("连接微信 / DeepSeek",null,(s,e)=>Connect("#settings"));menu.Items.Add("方案与复盘",null,(s,e)=>Connect("#plans"));
  var startup=new ToolStripMenuItem("登录 Windows 后自动启动");using(var key=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run"))startup.Checked=key!=null&&key.GetValue("Shishi")!=null;
  startup.CheckOnClick=true;startup.Click+=(s,e)=>{using(var key=Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")){if(startup.Checked)key.SetValue("Shishi","\""+Application.ExecutablePath+"\" --background");else key.DeleteValue("Shishi",false);}};menu.Items.Add(startup);
  menu.Items.Add("退出拾事与后台服务",null,(s,e)=>ExitThread());
  tray=new NotifyIcon{Icon=System.Drawing.SystemIcons.Application,Visible=true,Text="拾事 · 正在启动",ContextMenuStrip=menu};tray.DoubleClick+=(s,e)=>Connect("#inbox");
  timer=new System.Windows.Forms.Timer{Interval=10000};timer.Tick+=(s,e)=>Ensure(false,null);timer.Start();Ensure(!background,"#settings");
 }
 void Connect(string fragment){Ensure(true,fragment);}
 async void Ensure(bool show,string fragment){
  if(busy||closing)return;busy=true;
  try{
   bool ready=await System.Threading.Tasks.Task.Run(()=>Healthy());
   if(!ready){
    if(service==null||service.HasExited){
     string node=Path.Combine(root,"runtime","node.exe");if(!File.Exists(node))throw new Exception("运行组件缺失，请重新安装桌面版。");
     var info=new ProcessStartInfo(node,"server.mjs"){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
     info.EnvironmentVariables["SHISHI_PYTHON"]=Path.Combine(root,"runtime","python","python.exe");
     service=new Process{StartInfo=info};service.OutputDataReceived+=(s,e)=>Log(e.Data);service.ErrorDataReceived+=(s,e)=>Log(e.Data);service.Start();service.BeginOutputReadLine();service.BeginErrorReadLine();
    }
    for(int i=0;i<20&&!closing;i++){await System.Threading.Tasks.Task.Delay(500);ready=await System.Threading.Tasks.Task.Run(()=>Healthy());if(ready)break;}
   }
   if(closing)return;
   if(!ready)throw new Exception("本机服务尚未就绪。请检查 4317 端口是否被占用，或查看 data/desktop.log。");
   failures=0;tray.Text="拾事 · 后台服务运行中";if(show)Open(fragment??"#settings");
  }catch(Exception e){if(!closing){tray.Text="拾事 · 服务连接待检查";if(show||failures++==0)tray.ShowBalloonTip(8000,"拾事启动提醒",e.Message,ToolTipIcon.Warning);}}
  finally{busy=false;}
 }
 readonly object logLock=new object();
 void Log(string value){if(value==null)return;try{lock(logLock){string file=Path.Combine(root,"data","desktop.log");if(File.Exists(file)&&new FileInfo(file).Length>2000000)File.WriteAllText(file,"");File.AppendAllText(file,DateTime.Now.ToString("s")+" "+value+Environment.NewLine);}}catch{}}
 protected override void ExitThreadCore(){closing=true;timer.Stop();tray.Visible=false;tray.Dispose();try{if(service!=null&&!service.HasExited)Process.Start(new ProcessStartInfo("taskkill.exe","/PID "+service.Id+" /T /F"){UseShellExecute=false,CreateNoWindow=true}).WaitForExit(5000);}catch{}base.ExitThreadCore();}
}
