package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
)

// ================= 配置与全局变量 =================

var (
	// 命令行参数
	modeServer   string
	modeClient   string
	authToken    string
	allowedPorts string // 服务端配置串
	mappingPorts string // 客户端配置串
	localIP      string // 客户端监听绑定的IP

	// 全局 WebRTC 配置
	webrtcConfig = webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{
					"stun:stun.hot-chilli.net:3478",
					"stun:stun.miwifi.com:3478",
					"stun:stun.cdnbye.com:3478",
					"stun:fwa.lifesizecloud.com:3478",
				},
			},
		},
	}

	// 客户端全局状态
	clientPC      *webrtc.PeerConnection
	clientPCMutex sync.RWMutex
)

// 信令消息
type SignalMessage struct {
	Type      string                   `json:"type"`
	SDP       string                   `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit `json:"candidate,omitempty"`
}

// 端口映射结构
type PortPair struct {
	Src  string // 源端口 (Server: 真实服务端口 / Client: 远程虚拟端口)
	Dest string // 目标端口 (Server: 虚拟映射端口 / Client: 本地监听端口)
}

func main() {
	// 参数解析
	flag.StringVar(&modeServer, "server", "", "Server mode: listen address (e.g., 0.0.0.0:10001)")
	flag.StringVar(&modeClient, "client", "", "Client mode: signaling URL (e.g., ws://1.2.3.4:10001/ice)")
	flag.StringVar(&authToken, "token", "", "Authentication token")
	flag.StringVar(&allowedPorts, "ports", "", "Ports list (e.g., '80,25565:25566')")
	flag.StringVar(&mappingPorts, "ports-mapping", "", "Ports mapping for client (defaults to --ports value)")
	flag.StringVar(&localIP, "local", "127.0.0.1", "Local IP to bind for mapped ports (Client only)")
	flag.Parse()

	if modeServer != "" {
		if authToken == "" {
			log.Fatal("Server mode requires --token")
		}
		if allowedPorts == "" {
			log.Fatal("Server mode requires --ports")
		}
		runServer()
	} else if modeClient != "" {
		if authToken == "" {
			log.Fatal("Client mode requires --token")
		}
		// 如果没有专门指定 mappingPorts，则使用 allowedPorts (兼容旧行为)
		if mappingPorts == "" {
			if allowedPorts == "" {
				log.Fatal("Client mode requires --ports or --ports-mapping")
			}
			mappingPorts = allowedPorts
		}
		runClient()
	} else {
		flag.Usage()
	}
}

// =============================================================
//                       通用工具函数
// =============================================================

// 解析端口配置字符串
// Server端语义: RealPort:VirtualPort (Src: Real, Dest: Virtual)
// Client端语义: RemotePort:LocalPort (Src: Remote, Dest: Local)
func parsePorts(configStr string) ([]PortPair, error) {
	var pairs []PortPair
	usedDest := make(map[string]string) // 用于检测 Dest 冲突 (服务端Virtual重复 / 客户端Local重复)

	parts := strings.Split(configStr, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		var src, dest string
		if strings.Contains(part, ":") {
			// 格式 A:B
			sub := strings.Split(part, ":")
			if len(sub) != 2 {
				return nil, fmt.Errorf("invalid port format: %s", part)
			}
			src = strings.TrimSpace(sub[0])
			dest = strings.TrimSpace(sub[1])
		} else {
			// 格式 A (即 A:A)
			src = part
			dest = part
		}

		// 冲突检测
		if original, exists := usedDest[dest]; exists {
			return nil, fmt.Errorf("port conflict detected: %s is already mapped from %s", dest, original)
		}
		usedDest[dest] = src

		pairs = append(pairs, PortPair{Src: src, Dest: dest})
	}
	return pairs, nil
}

// =============================================================
//                           服务端逻辑
// =============================================================

func runServer() {
	// 解析端口: Src=RealService, Dest=VirtualLabel
	pairs, err := parsePorts(allowedPorts)
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}

	// 建立映射表: VirtualLabel -> RealService
	// 这样当 DataChannel 带着 VirtualLabel 连上来时，我们知道连去哪里
	portMap := make(map[string]string)
	for _, p := range pairs {
		portMap[p.Dest] = p.Src
		if p.Dest != p.Src {
			log.Printf("Mapping rule: Virtual port %s -> Local service %s", p.Dest, p.Src)
		} else {
			log.Printf("Allowed port: %s", p.Src)
		}
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	http.HandleFunc("/ice", func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token != authToken {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			log.Printf("Invalid token attempt from %s", r.RemoteAddr)
			return
		}

		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("Upgrade error:", err)
			return
		}
		log.Printf("Client connected from %s", r.RemoteAddr)

		handleServerSession(ws, portMap)
	})

	log.Printf("RTC Server listening on ws://%s/ice", modeServer)
	log.Fatal(http.ListenAndServe(modeServer, nil))
}

func handleServerSession(ws *websocket.Conn, portMap map[string]string) {
	defer ws.Close()

	pc, err := createPeerConnection()
	if err != nil {
		log.Println("NewPeerConnection error:", err)
		return
	}
	defer pc.Close()

	pc.OnDataChannel(func(d *webrtc.DataChannel) {
		label := d.Label()

		// 这里的 label 是客户端请求的“虚拟端口”
		realPort, allowed := portMap[label]

		// 忽略之前的修复用保活通道
		if label == "init-keepalive" {
			return
		}

		if !allowed {
			log.Printf("Refused connection to unauthorized/unknown label: %s", label)
			d.Close()
			return
		}

		d.OnOpen(func() {
			log.Printf("Tunnel opened: WebRTC[%s] -> TCP[127.0.0.1:%s]", label, realPort)
			raw, err := d.Detach()
			if err != nil {
				return
			}
			defer raw.Close()

			targetAddr := fmt.Sprintf("127.0.0.1:%s", realPort)
			conn, err := net.DialTimeout("tcp", targetAddr, 5*time.Second)
			if err != nil {
				log.Printf("Failed to dial local service %s: %v", targetAddr, err)
				return
			}
			defer conn.Close()

			go io.Copy(raw, conn)
			io.Copy(conn, raw)
		})
	})

	handleSignaling(ws, pc)
}

// =============================================================
//                           客户端逻辑
// =============================================================

func runClient() {
	// 解析端口: Src=RemoteVirtual, Dest=LocalListen
	pairs, err := parsePorts(mappingPorts)
	if err != nil {
		log.Fatalf("Config error: %v", err)
	}

	// 启动持久化监听器
	for _, p := range pairs {
		// p.Dest 是本地监听端口，p.Src 是远程虚拟端口
		go startPersistentListener(p.Dest, p.Src)
	}

	// 自动重连循环
	for {
		log.Println("Connecting to signaling server...")
		connectAndServe()
		log.Println("Signaling lost, retrying in 3 seconds...")
		time.Sleep(3 * time.Second)
	}
}

// localPort: 本地 TCP 监听端口
// remoteLabel: WebRTC DataChannel 标签（对应服务端的 Virtual Port）
func startPersistentListener(localPort, remoteLabel string) {
	addr := fmt.Sprintf("%s:%s", localIP, localPort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", addr, err)
	}
	log.Printf("Listening on %s -> Mapping to remote service label '%s'", addr, remoteLabel)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Accept error: %v", err)
			continue
		}

		go func(c net.Conn) {
			// 等待 WebRTC 就绪
			timeout := time.After(10 * time.Second) // 适当放宽超时
			ticker := time.NewTicker(200 * time.Millisecond)
			defer ticker.Stop()

			var pc *webrtc.PeerConnection
			ready := false

			for {
				select {
				case <-timeout:
					log.Println("Timeout waiting for WebRTC connection")
					c.Close()
					return
				case <-ticker.C:
					clientPCMutex.RLock()
					p := clientPC
					clientPCMutex.RUnlock()

					if p != nil && p.ConnectionState() == webrtc.PeerConnectionStateConnected {
						pc = p
						ready = true
						goto READY
					}
				}
			}

		READY:
			if !ready || pc == nil {
				c.Close()
				return
			}

			// 创建 DataChannel，使用 remoteLabel
			dc, err := pc.CreateDataChannel(remoteLabel, nil)
			if err != nil {
				log.Printf("CreateDataChannel failed: %v", err)
				c.Close()
				return
			}

			dc.OnOpen(func() {
				raw, err := dc.Detach()
				if err != nil {
					c.Close()
					return
				}
				go func() {
					defer c.Close()
					defer raw.Close()
					io.Copy(raw, c)
				}()
				go func() {
					defer c.Close()
					defer raw.Close()
					io.Copy(c, raw)
				}()
			})

			// 避免死锁或挂起的保护
			time.AfterFunc(10*time.Second, func() {
				if dc.ReadyState() != webrtc.DataChannelStateOpen {
					if dc.ReadyState() == webrtc.DataChannelStateConnecting {
						log.Printf("DataChannel '%s' open timeout", remoteLabel)
						c.Close()
					}
				}
			})

		}(conn)
	}
}

func connectAndServe() {
	u, err := url.Parse(modeClient)
	if err != nil {
		return
	}
	q := u.Query()
	q.Set("token", authToken)
	u.RawQuery = q.Encode()

	ws, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Println("WebSocket dial error:", err)
		return
	}
	defer ws.Close()

	pc, err := createPeerConnection()
	if err != nil {
		return
	}

	// [Fix] 创建初始保活通道，确保 SDP 包含媒体段
	_, err = pc.CreateDataChannel("init-keepalive", nil)
	if err != nil {
		log.Printf("Failed to create init data channel: %v", err)
		pc.Close()
		return
	}

	// ICE 状态监控
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		log.Printf("ICE State: %s", s.String())
		if s == webrtc.PeerConnectionStateConnected {
			clientPCMutex.Lock()
			clientPC = pc
			clientPCMutex.Unlock()
			log.Println(">>> Link Established! Ready to forward. <<<")
		} else if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			clientPCMutex.Lock()
			if clientPC == pc {
				clientPC = nil
			}
			clientPCMutex.Unlock()
			// 不主动 pc.Close() 避免竞态，交给外层循环或 WebSocket 断开处理
		}
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		pc.Close()
		return
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		pc.Close()
		return
	}

	err = ws.WriteJSON(SignalMessage{Type: "offer", SDP: offer.SDP})
	if err != nil {
		pc.Close()
		return
	}

	handleSignaling(ws, pc)
}

// =============================================================
//                           通用逻辑
// =============================================================

func createPeerConnection() (*webrtc.PeerConnection, error) {
	settingEngine := webrtc.SettingEngine{}
	settingEngine.DetachDataChannels()

	// [核心修复] 强制设置接收 MTU 为 1200
	// 这有助于避免跨 ISP 网络中的 UDP 分片丢包问题
	settingEngine.SetReceiveMTU(1200)

	api := webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine))
	return api.NewPeerConnection(webrtcConfig)
}

func handleSignaling(ws *websocket.Conn, pc *webrtc.PeerConnection) {
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		cInit := c.ToJSON()
		_ = ws.WriteJSON(SignalMessage{Type: "candidate", Candidate: &cInit})
	})

	for {
		var msg SignalMessage
		err := ws.ReadJSON(&msg)
		if err != nil {
			return
		}

		switch msg.Type {
		case "offer":
			pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: msg.SDP})
			answer, _ := pc.CreateAnswer(nil)
			pc.SetLocalDescription(answer)
			ws.WriteJSON(SignalMessage{Type: "answer", SDP: answer.SDP})
		case "answer":
			pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: msg.SDP})
		case "candidate":
			if msg.Candidate != nil {
				pc.AddICECandidate(*msg.Candidate)
			}
		}
	}
}
